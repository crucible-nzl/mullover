/* ============================================================
   COUNSEL.DAY · VOICE-TO-TEXT INPUT WIDGET
   Attaches a mic button to a <textarea> or <input> and dictates
   into it. Tries browser-native SpeechRecognition first (free,
   instant, no audio leaves the device). Falls back to POSTing
   audio to /api/transcribe (server-side Whisper) when the browser
   does not support SpeechRecognition or when SR errors out.

   Usage on a page:

     <script src="voice-input.js" defer></script>
     <script>
       window.addEventListener('DOMContentLoaded', function () {
         CounselDayVoice.attach('#note-text', { label: 'Speak the note' });
       });
     </script>

   The widget injects itself BEFORE the targeted field as a small
   row: [mic button] [status text]. No external CSS · uses inline
   styles that read from the i8 token variables (--wine, --ink,
   --muted, --rule, --paper) so it inherits the page theme.
   ============================================================ */
(function (global) {
  'use strict';

  var ENDPOINT = '/api/transcribe';
  var MAX_RECORD_MS = 30 * 1000; // 30s ceiling matches the server cap
  var RECORD_MIME_CANDIDATES = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4', // iOS Safari
    'audio/ogg;codecs=opus',
  ];

  function getRecorderMime() {
    if (typeof MediaRecorder === 'undefined') return null;
    for (var i = 0; i < RECORD_MIME_CANDIDATES.length; i++) {
      if (MediaRecorder.isTypeSupported(RECORD_MIME_CANDIDATES[i])) {
        return RECORD_MIME_CANDIDATES[i];
      }
    }
    return null;
  }

  function speechRecognitionSupported() {
    return !!(global.SpeechRecognition || global.webkitSpeechRecognition);
  }

  /* Detect mobile device. On Android Chrome `webkitSpeechRecognition`
     reports as supported but fails silently (no onresult, no error,
     onend with empty result) unless mic permission was pre-granted.
     iOS Safari has similar reliability issues. The Whisper fallback
     uses getUserMedia which triggers the standard mic-permission
     prompt and works consistently. So: on mobile, always Whisper. */
  function isMobile() {
    var ua = navigator.userAgent || '';
    if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua)) return true;
    // Touch-first device with a small viewport · catches tablets in
    // portrait, foldables, etc. that don't match the UA regex.
    if (('ontouchstart' in window) && window.innerWidth <= 1024) return true;
    return false;
  }

  function newSR() {
    var Ctor = global.SpeechRecognition || global.webkitSpeechRecognition;
    var sr = new Ctor();
    // continuous=true keeps the session alive across pauses · without
    // this, Chrome ends the session at the first 1-2 second pause,
    // any interim text is lost, and the user sees nothing.
    sr.continuous = true;
    sr.interimResults = true;
    sr.lang = (navigator.language || 'en-US');
    return sr;
  }

  /* ---- DOM building ---------------------------------------- */

  function buildButton(label) {
    var wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;align-items:center;gap:10px;margin:6px 0 10px;flex-wrap:wrap;';

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('aria-label', label || 'Dictate this note');
    btn.style.cssText = [
      'display:inline-flex',
      'align-items:center',
      'gap:8px',
      'padding:7px 12px',
      'background:var(--paper, #fff)',
      'color:var(--ink, #0a0a0a)',
      'border:1px solid var(--ink, #0a0a0a)',
      'border-radius:0',
      'font-family:var(--font-mono, ui-monospace, monospace)',
      'font-size:11px',
      'letter-spacing:0.12em',
      'text-transform:uppercase',
      'cursor:pointer',
      'transition:background 120ms ease, color 120ms ease',
    ].join(';');
    btn.innerHTML = micSvg() + '<span class="cd-vi-text">' + (label || 'Dictate') + '</span>';
    btn.addEventListener('mouseenter', function () {
      if (!btn.classList.contains('cd-vi-recording')) {
        btn.style.background = 'var(--ink, #0a0a0a)';
        btn.style.color = 'var(--paper, #fff)';
      }
    });
    btn.addEventListener('mouseleave', function () {
      if (!btn.classList.contains('cd-vi-recording')) {
        btn.style.background = 'var(--paper, #fff)';
        btn.style.color = 'var(--ink, #0a0a0a)';
      }
    });

    // Recording indicator · pulsing dot + live audio level bars +
    // live timer. Three signals next to the button so the user has
    // unambiguous visual confirmation that audio capture is live.
    // The bars are amplitude-driven via WebAudio AnalyserNode (real
    // data), so users see their own voice as movement.
    var indicator = document.createElement('span');
    indicator.className = 'cd-vi-indicator';
    indicator.style.cssText = 'display:none;align-items:center;gap:10px;font-family:var(--font-mono, ui-monospace, monospace);font-size:11px;letter-spacing:0.08em;';
    indicator.innerHTML =
      '<span class="cd-vi-dot" style="display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--wine, #722F37);animation:cdViPulse 1.1s ease-in-out infinite;"></span>' +
      '<span class="cd-vi-meter" aria-hidden="true" style="display:inline-flex;align-items:flex-end;gap:2px;height:18px;">' +
        '<span class="cd-vi-bar" style="display:inline-block;width:3px;height:4px;background:var(--wine, #722F37);transition:height 80ms linear;"></span>' +
        '<span class="cd-vi-bar" style="display:inline-block;width:3px;height:8px;background:var(--wine, #722F37);transition:height 80ms linear;"></span>' +
        '<span class="cd-vi-bar" style="display:inline-block;width:3px;height:14px;background:var(--wine, #722F37);transition:height 80ms linear;"></span>' +
        '<span class="cd-vi-bar" style="display:inline-block;width:3px;height:10px;background:var(--wine, #722F37);transition:height 80ms linear;"></span>' +
        '<span class="cd-vi-bar" style="display:inline-block;width:3px;height:6px;background:var(--wine, #722F37);transition:height 80ms linear;"></span>' +
      '</span>' +
      '<span class="cd-vi-timer" style="color:var(--wine, #722F37);font-weight:600;">0:00 / 0:30</span>';

    var status = document.createElement('span');
    status.className = 'cd-vi-status';
    status.style.cssText = 'font-family:var(--font-mono, ui-monospace, monospace);font-size:11px;letter-spacing:0.08em;color:var(--muted, #6b635a);';

    // "Not working?" diagnostic link · always present so any voice
    // failure is one click away from being reported / debugged.
    var diag = document.createElement('a');
    diag.href = '/diag-voice.html';
    diag.target = '_blank';
    diag.rel = 'noopener';
    diag.textContent = 'Test mic';
    diag.style.cssText = 'font-family:var(--font-mono, ui-monospace, monospace);font-size:10px;letter-spacing:0.08em;color:var(--muted, #6b635a);margin-left:auto;border-bottom:1px solid var(--rule, #e8e6e1);text-decoration:none;padding-bottom:1px;';
    diag.title = 'Open the voice-stack health check in a new tab';

    // Inject the pulse keyframes + textarea recording-state styles
    // once on first build (page-wide).
    if (!document.getElementById('cd-vi-keyframes')) {
      var sty = document.createElement('style');
      sty.id = 'cd-vi-keyframes';
      sty.textContent =
        '@keyframes cdViPulse { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.35); opacity: 0.55; } }' +
        '.cd-vi-warn .cd-vi-timer { color: #c0392b !important; }' +
        '.cd-vi-warn .cd-vi-bar { background: #c0392b !important; }' +
        // Red border on the textarea while recording · peripheral-
        // vision cue. Wraps both <input> and <textarea>.
        '.cd-vi-field-recording { outline: 2px solid var(--wine, #722F37) !important; outline-offset: 2px; box-shadow: 0 0 0 4px rgba(114,47,55,0.08) !important; }' +
        // Transcribing overlay · positioned outside the field as an
        // adjacent banner since the field may itself be inside a
        // bordered container. Animates in/out with opacity.
        '.cd-vi-transcribing { display: flex; align-items: center; gap: 10px; padding: 10px 14px; margin: 6px 0; background: var(--paper-deep, #faf8f4); border-left: 3px solid var(--wine, #722F37); font-family: var(--font-mono, ui-monospace, monospace); font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--wine, #722F37); }' +
        '.cd-vi-transcribing .dots { display: inline-flex; gap: 3px; }' +
        '.cd-vi-transcribing .dots span { display: inline-block; width: 5px; height: 5px; border-radius: 50%; background: var(--wine, #722F37); animation: cdViBounce 0.9s ease-in-out infinite; }' +
        '.cd-vi-transcribing .dots span:nth-child(2) { animation-delay: 0.15s; }' +
        '.cd-vi-transcribing .dots span:nth-child(3) { animation-delay: 0.3s; }' +
        '@keyframes cdViBounce { 0%, 80%, 100% { transform: translateY(0); opacity: 0.5; } 40% { transform: translateY(-4px); opacity: 1; } }';
      document.head.appendChild(sty);
    }

    wrap.appendChild(btn);
    wrap.appendChild(indicator);
    wrap.appendChild(status);
    wrap.appendChild(diag);
    return { wrap: wrap, btn: btn, status: status, indicator: indicator };
  }

  function micSvg() {
    return '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>';
  }

  function setRecording(btn, status, on, indicator) {
    // Allow callers to omit the indicator · pull it from the button's
    // sibling row so we can update the visual without threading the
    // reference through every call site.
    if (!indicator && btn && btn.parentElement) {
      indicator = btn.parentElement.querySelector('.cd-vi-indicator');
    }
    if (on) {
      btn.classList.add('cd-vi-recording');
      btn.style.background = 'var(--wine, #722F37)';
      btn.style.color = '#fff';
      btn.style.borderColor = 'var(--wine, #722F37)';
      btn.querySelector('.cd-vi-text').textContent = 'Stop';
      // Status line now mirrors the indicator. The pulsing dot + timer
      // are the primary signal; the status line carries hints.
      status.textContent = 'Tap Stop when done, or it will auto-stop at the cap.';
      status.style.color = 'var(--muted, #6b635a)';
      if (indicator) {
        indicator.style.display = 'inline-flex';
        var t = indicator.querySelector('.cd-vi-timer');
        if (t) t.textContent = '0:00 / 0:30';
      }
    } else {
      btn.classList.remove('cd-vi-recording');
      btn.style.background = 'var(--paper, #fff)';
      btn.style.color = 'var(--ink, #0a0a0a)';
      btn.style.borderColor = 'var(--ink, #0a0a0a)';
      btn.querySelector('.cd-vi-text').textContent = btn.dataset.label || 'Dictate';
      if (indicator) {
        indicator.style.display = 'none';
        indicator.classList.remove('cd-vi-warn');
      }
    }
  }

  // Drive the 5-bar amplitude meter inside the indicator from a live
  // MediaStream. Uses WebAudio AnalyserNode at fftSize=128 to compute
  // an RMS-ish reading per frame · cheap, no SAB / Worklets needed.
  // Returns a stop fn that detaches the analyser and resets bar heights.
  function startMeter(indicator, stream) {
    if (!indicator || !stream) return function () {};
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return function () {};
    var ctx;
    try { ctx = new AC(); } catch (e) { return function () {}; }
    var source, analyser;
    try {
      source = ctx.createMediaStreamSource(stream);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.55;
      source.connect(analyser);
    } catch (e) {
      try { ctx.close(); } catch (e2) {}
      return function () {};
    }
    var bars = indicator.querySelectorAll('.cd-vi-bar');
    var data = new Uint8Array(analyser.frequencyBinCount);
    var raf = 0;
    var minH = [3, 4, 5, 4, 3]; // visible baseline so bars never collapse to 0
    var maxH = [10, 16, 22, 18, 12];
    function tick() {
      analyser.getByteFrequencyData(data);
      // Take 5 bins spread across the meaningful voice range and map
      // to bar heights.
      for (var i = 0; i < bars.length; i++) {
        var idx = Math.floor((i + 1) * data.length / 7);
        var v = data[idx] || 0;
        var h = minH[i] + (v / 255) * (maxH[i] - minH[i]);
        bars[i].style.height = h.toFixed(1) + 'px';
      }
      raf = requestAnimationFrame(tick);
    }
    tick();
    return function () {
      if (raf) cancelAnimationFrame(raf);
      try { source.disconnect(); } catch (e) {}
      try { analyser.disconnect(); } catch (e) {}
      try { ctx.close(); } catch (e) {}
      for (var i = 0; i < bars.length; i++) bars[i].style.height = minH[i] + 'px';
    };
  }

  // Toggle a red-outline class on the bound field while recording so
  // the user has a peripheral-vision cue even when they're not looking
  // at the indicator strip.
  function setFieldRecording(field, on) {
    if (!field || !field.classList) return;
    field.classList.toggle('cd-vi-field-recording', !!on);
  }

  // Show / hide a "TRANSCRIBING AUDIO…" banner between the indicator
  // and the textarea. Visible from the moment Stop fires until /api/
  // transcribe returns and we append the text. Idempotent.
  function showTranscribingBanner(wrap) {
    if (!wrap) return null;
    var existing = wrap.parentNode && wrap.parentNode.querySelector('.cd-vi-transcribing');
    if (existing) return existing;
    var banner = document.createElement('div');
    banner.className = 'cd-vi-transcribing';
    banner.setAttribute('role', 'status');
    banner.setAttribute('aria-live', 'polite');
    banner.innerHTML = '<span>Transcribing audio</span><span class="dots"><span></span><span></span><span></span></span>';
    if (wrap.parentNode) wrap.parentNode.insertBefore(banner, wrap.nextSibling);
    return banner;
  }
  function hideTranscribingBanner(wrap) {
    if (!wrap || !wrap.parentNode) return;
    var b = wrap.parentNode.querySelector('.cd-vi-transcribing');
    if (b && b.parentNode) b.parentNode.removeChild(b);
  }

  // Start a 1Hz tick that updates the timer in the indicator and warns
  // the user when they're within 5 seconds of the cap. Returns a fn that
  // clears the interval.
  function startTimer(indicator, maxMs) {
    if (!indicator) return function () {};
    var startedAt = Date.now();
    var maxSec = Math.round(maxMs / 1000);
    function fmt(s) {
      var m = Math.floor(s / 60);
      var rs = s % 60;
      return m + ':' + (rs < 10 ? '0' : '') + rs;
    }
    function tick() {
      var elapsed = Math.floor((Date.now() - startedAt) / 1000);
      var remaining = Math.max(0, maxSec - elapsed);
      var timerEl = indicator.querySelector('.cd-vi-timer');
      if (timerEl) timerEl.textContent = fmt(elapsed) + ' / ' + fmt(maxSec);
      if (remaining <= 5) indicator.classList.add('cd-vi-warn');
    }
    tick();
    var id = setInterval(tick, 250);
    return function () { clearInterval(id); };
  }

  /* Disabled state · greyed-out button + tooltip. Used by compose.html
     when the user selects Solo Free (which is not entitled to voice).
     Setting disabled=false restores the regular look. */
  function setDisabled(btn, status, disabled, reason) {
    if (disabled) {
      btn.disabled = true;
      btn.style.background = 'var(--paper-deep, #fafaf8)';
      btn.style.color = 'var(--subtle, #9b9286)';
      btn.style.borderColor = 'var(--rule, #e8e6e1)';
      btn.style.cursor = 'not-allowed';
      btn.title = reason || 'Voice transcription is a paid-tier feature';
      status.textContent = reason || 'Available on paid tiers';
      status.style.color = 'var(--subtle, #9b9286)';
    } else {
      btn.disabled = false;
      btn.style.background = 'var(--paper, #fff)';
      btn.style.color = 'var(--ink, #0a0a0a)';
      btn.style.borderColor = 'var(--ink, #0a0a0a)';
      btn.style.cursor = 'pointer';
      btn.title = '';
      status.textContent = '';
    }
  }

  /* ---- transcript merging ---------------------------------- */

  function appendToField(field, text) {
    if (!text) return;
    var current = field.value || '';
    var sep = (current && !/\s$/.test(current)) ? ' ' : '';
    field.value = current + sep + text;
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /* ---- the two backends ------------------------------------ */

  function startWithSpeechRecognition(field, btn, status, onDone, onFallback) {
    var sr;
    try {
      sr = newSR();
    } catch (e) {
      console.warn('[CounselDayVoice] SR constructor failed · falling back to Whisper', e);
      onFallback();
      return null;
    }

    var finalChunks = [];
    var interim = '';
    var startMark = field.value.length;
    var stopped = false;
    var anyTextReceived = false;
    var sawAnyResult = false;

    function writeCurrent() {
      var preview = finalChunks.join(' ');
      var orig = field.value.slice(0, startMark);
      var sep = (orig && !/\s$/.test(orig)) ? ' ' : '';
      var next = orig + sep + (preview ? preview + ' ' : '') + interim;
      if (next !== field.value) {
        field.value = next;
        field.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }

    sr.onresult = function (event) {
      sawAnyResult = true;
      interim = '';
      for (var i = event.resultIndex; i < event.results.length; i++) {
        var r = event.results[i];
        if (r.isFinal) {
          var t = (r[0].transcript || '').trim();
          if (t) { finalChunks.push(t); anyTextReceived = true; }
        } else {
          interim += r[0].transcript;
          if (r[0].transcript.trim()) anyTextReceived = true;
        }
      }
      writeCurrent();
      if (anyTextReceived) {
        status.textContent = 'Listening · text appearing live …';
        status.style.color = 'var(--wine, #722F37)';
      }
    };
    sr.onerror = function (e) {
      console.warn('[CounselDayVoice] SR error · ' + (e && e.error), e);
      stopped = true;
      // For ANY error · denied permission, no-speech, audio-capture,
      // service-not-allowed, network, language-not-supported, aborted
      // mid-flight without any captured text · fall back to Whisper.
      // The previous behaviour silently ended the session on unknown
      // errors, which is the failure mode the user hit on /daily.
      if (!anyTextReceived) {
        status.textContent = 'Switching to recorded transcription …';
        status.style.color = 'var(--muted, #6b635a)';
        onFallback();
      } else {
        // We got some text · accept it and stop. Don't trigger Whisper
        // because it would record a fresh clip and duplicate the entry.
        status.textContent = 'Transcribed. Edit before sealing.';
        status.style.color = 'var(--muted, #6b635a)';
        setRecording(btn, status, false);
        setFieldRecording(field, false);
        onDone();
      }
    };
    sr.onend = function () {
      if (stopped) return;
      // If SR ended on its own (Chrome's continuous mode caps at ~60s,
      // or the user paused for too long and the underlying engine quit)
      // AND we never received any text, fall back to Whisper so the
      // user isn't left wondering why nothing happened.
      if (!sawAnyResult) {
        console.warn('[CounselDayVoice] SR ended with no results · falling back to Whisper');
        stopped = true;
        status.textContent = 'Switching to recorded transcription …';
        status.style.color = 'var(--muted, #6b635a)';
        onFallback();
        return;
      }
      setRecording(btn, status, false);
      setFieldRecording(field, false);
      status.textContent = anyTextReceived ? 'Transcribed. Edit before sealing.' : '';
      status.style.color = 'var(--muted, #6b635a)';
      onDone();
    };

    try {
      sr.start();
      setRecording(btn, status, true);
      setFieldRecording(field, true);
      return {
        // User-initiated stop · if SR captured ANY text by the time
        // they stopped, accept it. If SR captured nothing (SR was
        // probably silently dead from the start), fall back to
        // Whisper instead of leaving the user with an empty box.
        stop: function () {
          stopped = true;
          try { sr.stop(); } catch (e) {}
          if (!anyTextReceived) {
            setRecording(btn, status, false);
            setFieldRecording(field, false);
            status.textContent = 'Switching to recorded transcription …';
            status.style.color = 'var(--muted, #6b635a)';
            onFallback();
            return;
          }
          setRecording(btn, status, false);
          setFieldRecording(field, false);
          status.textContent = 'Transcribed. Edit before sealing.';
          status.style.color = 'var(--muted, #6b635a)';
        }
      };
    } catch (e) {
      onFallback();
      return null;
    }
  }

  function startWithWhisper(field, btn, status, decisionId, onDone) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      status.textContent = 'Voice input is not supported in this browser. Type the note.';
      status.style.color = 'var(--wine, #722F37)';
      setRecording(btn, status, false);
      onDone();
      return null;
    }
    var mime = getRecorderMime();
    if (!mime) {
      status.textContent = 'Audio recording not supported in this browser. Type the note.';
      status.style.color = 'var(--wine, #722F37)';
      setRecording(btn, status, false);
      onDone();
      return null;
    }

    var rec = null;
    var stream = null;
    var chunks = [];
    var hardStop = null;
    var stopTimer = null;
    var stopMeter = null;
    var indicator = btn && btn.parentElement && btn.parentElement.querySelector('.cd-vi-indicator');
    var wrap = btn && btn.parentElement;

    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(function (s) {
        stream = s;
        rec = new MediaRecorder(s, { mimeType: mime });
        rec.ondataavailable = function (e) { if (e.data && e.data.size > 0) chunks.push(e.data); };
        rec.onstop = function () {
          if (stopMeter) { stopMeter(); stopMeter = null; }
          setFieldRecording(field, false);
          // Show the transcribing banner the moment recording stops ·
          // /api/transcribe usually takes 1-3 seconds, and without a
          // status the field looks dead.
          showTranscribingBanner(wrap);
          if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
          if (hardStop) clearTimeout(hardStop);
          if (stopTimer) { stopTimer(); stopTimer = null; }
          var blob = new Blob(chunks, { type: mime });
          if (blob.size === 0) {
            status.textContent = 'No audio captured.';
            status.style.color = 'var(--wine, #722F37)';
            setRecording(btn, status, false);
            onDone();
            return;
          }
          status.textContent = 'Transcribing …';
          status.style.color = 'var(--muted, #6b635a)';
          var fd = new FormData();
          fd.append('audio', blob, 'note.' + (mime.indexOf('mp4') >= 0 ? 'm4a' : 'webm'));
          if (decisionId) fd.append('decision_id', decisionId);
          fetch(ENDPOINT, { method: 'POST', credentials: 'include', body: fd })
            .then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); })
            .then(function (res) {
              hideTranscribingBanner(wrap);
              if (res.status === 200 && res.body && res.body.ok) {
                appendToField(field, res.body.transcript || '');
                var quotaSuffix = '';
                if (res.body.quota) {
                  var remaining = Math.max(0, res.body.quota.limit - res.body.quota.used_today);
                  quotaSuffix = ' (' + Math.round(remaining) + 's left today)';
                }
                status.textContent = 'Transcribed. Edit before sealing.' + quotaSuffix;
                status.style.color = 'var(--muted, #6b635a)';
              } else {
                status.textContent = (res.body && res.body.message) || 'Transcription failed. Type the note.';
                status.style.color = 'var(--wine, #722F37)';
              }
              setRecording(btn, status, false);
              onDone();
            })
            .catch(function () {
              hideTranscribingBanner(wrap);
              status.textContent = 'Network error. Type the note.';
              status.style.color = 'var(--wine, #722F37)';
              setRecording(btn, status, false);
              onDone();
            });
        };
        rec.start();
        setRecording(btn, status, true);
        setFieldRecording(field, true);
        stopMeter = startMeter(indicator, stream);
        stopTimer = startTimer(indicator, MAX_RECORD_MS);
        hardStop = setTimeout(function () {
          if (rec.state === 'recording') {
            // Make the auto-stop visible · users were missing the silent
            // cutoff at 30s. Status flashes a clear "Cap reached" line
            // and the indicator stops pulsing immediately.
            status.textContent = 'Cap reached at ' + Math.round(MAX_RECORD_MS / 1000) + 's · transcribing now.';
            status.style.color = 'var(--wine, #722F37)';
            rec.stop();
          }
        }, MAX_RECORD_MS);
      })
      .catch(function () {
        status.textContent = 'Microphone permission denied. Type the note.';
        status.style.color = 'var(--wine, #722F37)';
        setRecording(btn, status, false);
        onDone();
      });

    return {
      stop: function () {
        if (rec && rec.state === 'recording') rec.stop();
      }
    };
  }

  /* ---- public API ------------------------------------------ */

  var Voice = {
    attach: function (selectorOrEl, opts) {
      opts = opts || {};
      var field = (typeof selectorOrEl === 'string') ? document.querySelector(selectorOrEl) : selectorOrEl;
      if (!field) {
        // Loud failure · the most common silent break is the field
        // selector not matching (typo, wrong id, element rendered
        // after script ran). Surface it in the console so a
        // developer sees it in DevTools immediately.
        console.warn('[CounselDayVoice] attach failed · selector returned no element ·', selectorOrEl);
        return null;
      }
      // Idempotent · don't attach twice
      if (field.dataset.cdVoiceAttached === '1') return null;
      field.dataset.cdVoiceAttached = '1';

      var built = buildButton(opts.label || 'Dictate');
      built.btn.dataset.label = opts.label || 'Dictate';

      // Insert above the field (or above the field's wrapping label)
      var anchor = field;
      // If the textarea sits inside a label, place the button above the
      // label so it doesn't fight the field for focus.
      if (field.parentNode && field.parentNode.tagName === 'LABEL') anchor = field.parentNode;
      anchor.parentNode.insertBefore(built.wrap, anchor);

      // decisionId may be supplied at attach-time (vote-today) or set
      // later via the returned handle (e.g. once the user has filed a
      // decision). The widget passes it on every Whisper request so the
      // server can enforce the tier gate + daily quota.
      var decisionId = opts.decisionId || null;

      // If the page wants this widget disabled from the start (e.g.
      // compose.html when Solo Free is the current tier), honour it.
      if (opts.disabled) {
        setDisabled(built.btn, built.status, true, opts.disabledReason);
      }

      var activeHandle = null;

      function stopActive() {
        if (activeHandle && typeof activeHandle.stop === 'function') {
          activeHandle.stop();
          activeHandle = null;
        }
      }

      built.btn.addEventListener('click', function () {
        if (built.btn.disabled) return;
        if (activeHandle) {
          stopActive();
          return;
        }
        built.status.textContent = 'Listening …';
        built.status.style.color = 'var(--muted, #6b635a)';

        // Mobile: skip browser SpeechRecognition (Android Chrome + iOS
        // Safari are unreliable here · they report as supported but
        // often fail silently). Go straight to Whisper which uses
        // getUserMedia + the standard mic permission prompt.
        var preferWhisper = opts.preferWhisper === true || isMobile();
        if (!preferWhisper && speechRecognitionSupported()) {
          activeHandle = startWithSpeechRecognition(field, built.btn, built.status, function () {
            activeHandle = null;
          }, function () {
            // SR failed mid-flight · fall back to Whisper
            activeHandle = null;
            built.status.textContent = 'Switching to server transcription …';
            activeHandle = startWithWhisper(field, built.btn, built.status, decisionId, function () { activeHandle = null; });
          });
        } else {
          activeHandle = startWithWhisper(field, built.btn, built.status, decisionId, function () { activeHandle = null; });
        }
      });

      return {
        stop: stopActive,
        setDecisionId: function (id) { decisionId = id || null; },
        setDisabled: function (disabled, reason) { setDisabled(built.btn, built.status, !!disabled, reason); },
      };
    }
  };

  global.CounselDayVoice = Voice;
})(window);
