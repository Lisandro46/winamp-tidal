// SMTC helper: bridges Windows' GlobalSystemMediaTransportControls to the Electron app.
//
// Protocol (one JSON object per line):
//   stdin  <- {"id":1,"cmd":"play|pause|toggle|next|previous|seek|stop","target":"tidal|spotify|any","positionMs":1234}
//   stdout -> {"type":"result","id":1,"ok":true,"error":null}
//   stdout -> {"type":"sessions","sessions":[{...}]}   (on change and every second)

using System.Text.Json;
using System.Text.Json.Serialization;
using Windows.Media.Control;
using Windows.Storage.Streams;
using MediaManager = Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager;
using MediaSession = Windows.Media.Control.GlobalSystemMediaTransportControlsSession;

var jsonOptions = new JsonSerializerOptions
{
    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
};
var stdoutLock = new object();

void Emit(object message)
{
    var line = JsonSerializer.Serialize(message, jsonOptions);
    lock (stdoutLock)
    {
        Console.Out.WriteLine(line);
        Console.Out.Flush();
    }
}

// Diagnostics go to stderr so they never corrupt the JSON stream on stdout.
static bool LogError(Exception error)
{
    Console.Error.WriteLine(error.ToString());
    return true;
}

var manager = await MediaManager.RequestAsync();

// Thumbnails are expensive to read, so cache the last one per session+track.
var thumbnailCache = new Dictionary<string, string?>();

static bool Matches(MediaSession session, string target) => target switch
{
    "tidal" => session.SourceAppUserModelId.Contains("TIDAL", StringComparison.OrdinalIgnoreCase)
            || session.SourceAppUserModelId.Contains("WiMPMusic", StringComparison.OrdinalIgnoreCase),
    "spotify" => session.SourceAppUserModelId.Contains("Spotify", StringComparison.OrdinalIgnoreCase),
    _ => true,
};

MediaSession? FindSession(string target)
{
    if (target is "any" or "" or "system")
    {
        return manager.GetCurrentSession();
    }
    return manager.GetSessions().FirstOrDefault(s => Matches(s, target));
}

async Task<string?> ReadThumbnail(IRandomAccessStreamReference? reference)
{
    if (reference == null) return null;
    try
    {
        using var stream = await reference.OpenReadAsync();
        var bytes = new byte[stream.Size];
        using var reader = new DataReader(stream);
        await reader.LoadAsync((uint)stream.Size);
        reader.ReadBytes(bytes);
        var mime = string.IsNullOrEmpty(stream.ContentType) ? "image/png" : stream.ContentType;
        return $"data:{mime};base64,{Convert.ToBase64String(bytes)}";
    }
    catch (Exception describeError) when (LogError(describeError))
    {
        return null;
    }
}

async Task<object?> DescribeSession(MediaSession session)
{
    try
    {
        var props = await session.TryGetMediaPropertiesAsync();
        var playback = session.GetPlaybackInfo();
        var timeline = session.GetTimelineProperties();
        var isPlaying = playback.PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing;

        // Timeline is only refreshed occasionally by apps; extrapolate while playing.
        var position = timeline.Position;
        if (isPlaying && timeline.LastUpdatedTime > DateTimeOffset.MinValue)
        {
            position += DateTimeOffset.Now - timeline.LastUpdatedTime;
        }
        var duration = timeline.EndTime - timeline.StartTime;
        if (duration > TimeSpan.Zero && position > duration) position = duration;

        var cacheKey = $"{session.SourceAppUserModelId}|{props.Artist}|{props.Title}";
        if (!thumbnailCache.TryGetValue(cacheKey, out var thumbnail))
        {
            thumbnail = await ReadThumbnail(props.Thumbnail);
            thumbnailCache.Clear();
            thumbnailCache[cacheKey] = thumbnail;
        }

        return new
        {
            appId = session.SourceAppUserModelId,
            title = props.Title,
            artist = props.Artist,
            album = props.AlbumTitle,
            isPlaying,
            status = playback.PlaybackStatus.ToString(),
            positionMs = (long)position.TotalMilliseconds,
            durationMs = (long)duration.TotalMilliseconds,
            canSeek = playback.Controls.IsPlaybackPositionEnabled,
            thumbnail,
        };
    }
    catch (Exception describeError) when (LogError(describeError))
    {
        return null;
    }
}

async Task EmitSessions()
{
    var current = manager.GetCurrentSession();
    var sessions = new List<object>();
    foreach (var session in manager.GetSessions())
    {
        var described = await DescribeSession(session);
        if (described != null) sessions.Add(described);
    }
    Emit(new { type = "sessions", current = current?.SourceAppUserModelId, sessions });
}

var emitGate = new SemaphoreSlim(1, 1);
async Task SafeEmitSessions()
{
    if (!await emitGate.WaitAsync(0)) return;
    try { await EmitSessions(); }
    finally { emitGate.Release(); }
}

void Watch(MediaSession session)
{
    session.MediaPropertiesChanged += (_, _) => _ = SafeEmitSessions();
    session.PlaybackInfoChanged += (_, _) => _ = SafeEmitSessions();
}

var watched = new HashSet<string>();
foreach (var session in manager.GetSessions())
{
    if (watched.Add(session.SourceAppUserModelId)) Watch(session);
}
manager.SessionsChanged += (m, args) =>
{
    foreach (var session in m.GetSessions())
    {
        if (watched.Add(session.SourceAppUserModelId)) Watch(session);
    }
    _ = SafeEmitSessions();
};
manager.CurrentSessionChanged += (_, _) => _ = SafeEmitSessions();

async Task<(bool ok, string? error)> RunCommand(JsonElement command)
{
    var cmd = command.GetProperty("cmd").GetString() ?? "";
    var target = command.TryGetProperty("target", out var t) ? t.GetString() ?? "any" : "any";

    if (cmd == "list")
    {
        await EmitSessions();
        return (true, null);
    }

    var session = FindSession(target);
    if (session == null) return (false, $"No media session found for '{target}'");

    var ok = cmd switch
    {
        "play" => await session.TryPlayAsync(),
        "pause" => await session.TryPauseAsync(),
        "toggle" => await session.TryTogglePlayPauseAsync(),
        "stop" => await session.TryStopAsync(),
        "next" => await session.TrySkipNextAsync(),
        "previous" => await session.TrySkipPreviousAsync(),
        "seek" => await session.TryChangePlaybackPositionAsync(
            TimeSpan.FromMilliseconds(command.GetProperty("positionMs").GetInt64()).Ticks),
        _ => throw new InvalidOperationException($"Unknown command '{cmd}'"),
    };
    _ = SafeEmitSessions();
    return (ok, ok ? null : $"'{cmd}' was rejected by {session.SourceAppUserModelId}");
}

// Periodic refresh keeps positions moving in the UI even when apps don't fire events.
_ = Task.Run(async () =>
{
    while (true)
    {
        await SafeEmitSessions();
        await Task.Delay(1000);
    }
});

string? line;
while ((line = await Console.In.ReadLineAsync()) != null)
{
    if (string.IsNullOrWhiteSpace(line)) continue;
    long? id = null;
    try
    {
        using var doc = JsonDocument.Parse(line);
        if (doc.RootElement.TryGetProperty("id", out var idElement)) id = idElement.GetInt64();
        var (ok, error) = await RunCommand(doc.RootElement);
        Emit(new { type = "result", id, ok, error });
    }
    catch (Exception ex)
    {
        Emit(new { type = "result", id, ok = false, error = ex.Message });
    }
}
