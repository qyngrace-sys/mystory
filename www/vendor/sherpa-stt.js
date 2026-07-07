(function (global) {
  "use strict";

  var SHERPA_BASE = "vendor/sherpa-ncnn/";
  var EXPECTED_SAMPLE_RATE = 16000;

  var loadPromise = null;
  var recognizer = null;
  var stream = null;
  var audioCtx = null;
  var mediaStream = null;
  var processor = null;
  var recordSampleRate = 16000;
  var lastResult = "";
  var micActive = false;
  var callbacks = { onPartial: null, onFinal: null, onStatus: null };

  function downsampleBuffer(buffer, exportSampleRate) {
    if (exportSampleRate === recordSampleRate) return buffer;
    var sampleRateRatio = recordSampleRate / exportSampleRate;
    var newLength = Math.round(buffer.length / sampleRateRatio);
    var result = new Float32Array(newLength);
    var offsetResult = 0;
    var offsetBuffer = 0;
    while (offsetResult < result.length) {
      var nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
      var accum = 0;
      var count = 0;
      for (var i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
        accum += buffer[i];
        count++;
      }
      result[offsetResult] = count ? accum / count : 0;
      offsetResult++;
      offsetBuffer = nextOffsetBuffer;
    }
    return result;
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var existing = document.querySelector('script[data-sherpa-src="' + src + '"]');
      if (existing) {
        if (existing.getAttribute("data-sherpa-loaded") === "1") {
          resolve();
          return;
        }
        existing.addEventListener("load", function () {
          resolve();
        });
        existing.addEventListener("error", reject);
        return;
      }
      var s = document.createElement("script");
      s.src = src;
      s.async = false;
      s.setAttribute("data-sherpa-src", src);
      s.onload = function () {
        s.setAttribute("data-sherpa-loaded", "1");
        resolve();
      };
      s.onerror = function () {
        reject(new Error("无法加载 " + src));
      };
      document.head.appendChild(s);
    });
  }

  function notifyStatus(text) {
    if (callbacks.onStatus && text) callbacks.onStatus(String(text));
  }

  function ensureModuleConfig() {
    global.Module = global.Module || {};
    if (!Module.locateFile) {
      Module.locateFile = function (path) {
        return SHERPA_BASE + path;
      };
    }
    if (!Module.setStatus) {
      Module.setStatus = function (text) {
        notifyStatus(text);
      };
    }
  }

  function decodeLoop() {
    if (!recognizer || !stream) return;
    while (recognizer.isReady(stream)) {
      recognizer.decode(stream);
    }
    var result = recognizer.getResult(stream);
    if (result && result !== lastResult) {
      lastResult = result;
      if (callbacks.onPartial) callbacks.onPartial(result);
    }
    if (recognizer.isEndpoint(stream)) {
      var finalText = String(lastResult || result || "").trim();
      if (finalText && callbacks.onFinal) callbacks.onFinal(finalText);
      lastResult = "";
      recognizer.reset(stream);
    }
  }

  function feedSamples(samples) {
    if (!recognizer) return;
    if (!stream) stream = recognizer.createStream();
    stream.acceptWaveform(EXPECTED_SAMPLE_RATE, samples);
    decodeLoop();
  }

  function resampleTo16k(samples, sampleRate) {
    if (sampleRate === EXPECTED_SAMPLE_RATE) return samples;
    recordSampleRate = sampleRate;
    return downsampleBuffer(samples, EXPECTED_SAMPLE_RATE);
  }

  async function load(opts) {
    opts = opts || {};
    if (typeof location !== "undefined" && location.protocol === "file:") {
      throw new Error("不能直接双击 index.html，请用 http://localhost:8080 等方式打开");
    }
    if (recognizer) return recognizer;
    if (loadPromise) return loadPromise;
    callbacks.onStatus = opts.onStatus || null;
    loadPromise = (async function () {
      ensureModuleConfig();
      notifyStatus("正在加载语音识别模型…");
      var runtimeReady = new Promise(function (resolve) {
        if (Module.calledRun) {
          resolve();
          return;
        }
        var prev = Module.onRuntimeInitialized;
        Module.onRuntimeInitialized = function () {
          if (typeof prev === "function") {
            try {
              prev();
            } catch (_e) {}
          }
          resolve();
        };
      });
      await loadScript(SHERPA_BASE + "sherpa-ncnn.js");
      await loadScript(SHERPA_BASE + "sherpa-ncnn-wasm-main.js");
      if (!Module.calledRun) await runtimeReady;
      if (typeof createRecognizer !== "function") {
        throw new Error("sherpa-ncnn 初始化失败：缺少 createRecognizer");
      }
      recognizer = createRecognizer(Module);
      notifyStatus("");
      return recognizer;
    })().catch(function (err) {
      loadPromise = null;
      throw err;
    });
    return loadPromise;
  }

  function isReady() {
    return !!recognizer;
  }

  function stopMic() {
    micActive = false;
    lastResult = "";
    if (processor) {
      try {
        processor.onaudioprocess = null;
        processor.disconnect();
      } catch (_e) {}
      processor = null;
    }
    if (mediaStream) {
      mediaStream.getTracks().forEach(function (t) {
        try {
          t.stop();
        } catch (_e2) {}
      });
      mediaStream = null;
    }
    if (stream) {
      try {
        stream.free();
      } catch (_e3) {}
      stream = null;
    }
  }

  async function startMic(opts) {
    opts = opts || {};
    callbacks.onPartial = opts.onPartial || null;
    callbacks.onFinal = opts.onFinal || null;
    callbacks.onStatus = opts.onStatus || callbacks.onStatus;
    await load({ onStatus: callbacks.onStatus });
    if (micActive) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("当前浏览器不支持麦克风");
    }
    stopMic();
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (!audioCtx) audioCtx = new AudioContext({ sampleRate: EXPECTED_SAMPLE_RATE });
    if (audioCtx.state === "suspended") await audioCtx.resume();
    recordSampleRate = audioCtx.sampleRate;
    var source = audioCtx.createMediaStreamSource(mediaStream);
    var bufferSize = 4096;
    processor = audioCtx.createScriptProcessor(bufferSize, 1, 1);
    processor.onaudioprocess = function (ev) {
      if (!micActive || !recognizer) return;
      var input = ev.inputBuffer.getChannelData(0);
      var copy = new Float32Array(input.length);
      copy.set(input);
      var samples = resampleTo16k(copy, recordSampleRate);
      feedSamples(samples);
    };
    source.connect(processor);
    processor.connect(audioCtx.destination);
    micActive = true;
  }

  async function transcribeBlob(blob) {
    await load({ onStatus: callbacks.onStatus });
    if (!blob || !blob.size) throw new Error("音频为空");
    var buf = await blob.arrayBuffer();
    if (!audioCtx) audioCtx = new AudioContext({ sampleRate: EXPECTED_SAMPLE_RATE });
    if (audioCtx.state === "suspended") await audioCtx.resume();
    var audioBuffer = await audioCtx.decodeAudioData(buf.slice(0));
    var samples = audioBuffer.getChannelData(0);
    samples = resampleTo16k(samples, audioBuffer.sampleRate);
    var localStream = recognizer.createStream();
    var parts = [];
    var chunkSize = EXPECTED_SAMPLE_RATE;
    var pending = "";
    for (var i = 0; i < samples.length; i += chunkSize) {
      var chunk = samples.subarray(i, Math.min(i + chunkSize, samples.length));
      localStream.acceptWaveform(EXPECTED_SAMPLE_RATE, chunk);
      while (recognizer.isReady(localStream)) {
        recognizer.decode(localStream);
      }
      pending = recognizer.getResult(localStream).trim();
      if (recognizer.isEndpoint(localStream)) {
        if (pending) parts.push(pending);
        recognizer.reset(localStream);
        pending = "";
      }
    }
    localStream.acceptWaveform(EXPECTED_SAMPLE_RATE, new Float32Array(Math.floor(EXPECTED_SAMPLE_RATE * 0.4)));
    while (recognizer.isReady(localStream)) {
      recognizer.decode(localStream);
    }
    pending = recognizer.getResult(localStream).trim();
    if (pending) parts.push(pending);
    localStream.free();
    var text = parts.join("\n").trim();
    if (!text) throw new Error("未识别到语音内容");
    return text;
  }

  global.SherpaStt = {
    basePath: SHERPA_BASE,
    load: load,
    isReady: isReady,
    startMic: startMic,
    stopMic: stopMic,
    transcribeBlob: transcribeBlob,
  };
})(typeof window !== "undefined" ? window : globalThis);
