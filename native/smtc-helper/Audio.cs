using NAudio.CoreAudioApi;
using NAudio.Wave;

/// <summary>
/// Default output device helpers: master volume (read/write) and loopback
/// capture of whatever is playing, downmixed for the Winamp visualizer.
/// </summary>
sealed class AudioServices : IDisposable
{
    const int VisualizerTargetRate = 22050;

    readonly Action<object> emit;
    readonly MMDeviceEnumerator enumerator = new();
    readonly object captureLock = new();
    WasapiLoopbackCapture? capture;
    string? captureDeviceId;
    bool visualizerEnabled;
    int lastVolume = -1;
    bool lastMuted;

    public AudioServices(Action<object> emit)
    {
        this.emit = emit;
    }

    MMDevice DefaultDevice() => enumerator.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);

    // ---- Volume ---------------------------------------------------------

    public void SetVolume(int volume)
    {
        using var device = DefaultDevice();
        device.AudioEndpointVolume.MasterVolumeLevelScalar = Math.Clamp(volume, 0, 100) / 100f;
        PollVolume(force: true);
    }

    /// <summary>Emits a "volume" message when the system volume or mute changed.</summary>
    public void PollVolume(bool force = false)
    {
        try
        {
            using var device = DefaultDevice();
            var endpoint = device.AudioEndpointVolume;
            var volume = (int)Math.Round(endpoint.MasterVolumeLevelScalar * 100);
            var muted = endpoint.Mute;
            if (!force && volume == lastVolume && muted == lastMuted) return;
            lastVolume = volume;
            lastMuted = muted;
            emit(new { type = "volume", volume, muted, device = device.FriendlyName });
        }
        catch (Exception error)
        {
            Console.Error.WriteLine($"volume poll failed: {error.Message}");
        }
    }

    // ---- Visualizer (loopback capture) -----------------------------------

    public void SetVisualizer(bool enabled)
    {
        visualizerEnabled = enabled;
        if (enabled) EnsureCapture();
        else StopCapture();
    }

    /// <summary>Restarts capture when the default output device changes.</summary>
    public void CheckDevice()
    {
        if (!visualizerEnabled) return;
        try
        {
            using var device = DefaultDevice();
            if (device.ID != captureDeviceId) EnsureCapture(restart: true);
        }
        catch (Exception error)
        {
            Console.Error.WriteLine($"device check failed: {error.Message}");
        }
    }

    void EnsureCapture(bool restart = false)
    {
        lock (captureLock)
        {
            if (capture != null && !restart) return;
            StopCaptureLocked();
            var device = DefaultDevice();
            captureDeviceId = device.ID;
            var next = new WasapiLoopbackCapture(device);
            var format = next.WaveFormat;
            var step = Math.Max(1, format.SampleRate / VisualizerTargetRate);
            var outRate = format.SampleRate / step;
            next.DataAvailable += (_, args) => OnData(args, format, step, outRate);
            next.RecordingStopped += (_, args) =>
            {
                if (args.Exception != null) Console.Error.WriteLine($"capture stopped: {args.Exception.Message}");
            };
            next.StartRecording();
            capture = next;
        }
    }

    void OnData(WaveInEventArgs args, WaveFormat format, int step, int outRate)
    {
        if (args.BytesRecorded == 0) return;
        var channels = format.Channels;
        var isFloat = format.Encoding == WaveFormatEncoding.IeeeFloat
            || (format is WaveFormatExtensible ext && ext.SubFormat == NAudio.Dmo.AudioMediaSubtypes.MEDIASUBTYPE_IEEE_FLOAT);
        var bytesPerSample = format.BitsPerSample / 8;
        var frameBytes = bytesPerSample * channels;
        var frames = args.BytesRecorded / frameBytes;
        var output = new short[(frames + step - 1) / step];
        var n = 0;

        for (var frame = 0; frame < frames; frame += step)
        {
            double sum = 0;
            for (var channel = 0; channel < channels; channel++)
            {
                var offset = frame * frameBytes + channel * bytesPerSample;
                sum += isFloat
                    ? BitConverter.ToSingle(args.Buffer, offset)
                    : BitConverter.ToInt16(args.Buffer, offset) / 32768.0;
            }
            output[n++] = (short)Math.Clamp(sum / channels * 32767, short.MinValue, short.MaxValue);
        }

        var bytes = new byte[n * 2];
        Buffer.BlockCopy(output, 0, bytes, 0, bytes.Length);
        emit(new { type = "pcm", rate = outRate, data = Convert.ToBase64String(bytes) });
    }

    void StopCapture()
    {
        lock (captureLock) StopCaptureLocked();
    }

    void StopCaptureLocked()
    {
        if (capture == null) return;
        try
        {
            capture.StopRecording();
            capture.Dispose();
        }
        catch (Exception error)
        {
            Console.Error.WriteLine($"capture stop failed: {error.Message}");
        }
        capture = null;
        captureDeviceId = null;
    }

    public void Dispose()
    {
        StopCapture();
        enumerator.Dispose();
    }
}
