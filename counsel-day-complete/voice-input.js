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
    sr.continuous = false;
    sr.interimResults = true;
    sr.lang = (navigator.language || 'en-US');
    return sr;
  }

  /* ---- DOM building ---------------------------------------- */

  function buildButton(label) {
    var wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;align-items:center;gap:10px;margin:6px 0 10px;';

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

    wrap.appendChild(btn);
    wrap.appendChild(status);
    wrap.appendChild(diag);
    return { wrap: wrap, btn: btn, status: status };
  }

  function micSvg() {
    return '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>';
  }

  function setRecording(btn, status, on) {
    if (on) {
      btn.classList.add('cd-vi-recording');
      btn.style.background = 'var(--wine, #722F37)';
      btn.style.color = '#fff';
      btn.style.borderColor = 'var(--wine, #722F37)';
      btn.querySelector('.cd-vi-text').textContent = 'Stop';
      status.textContent = 'Recording … 30s max';
      status.style.color = 'var(--wine, #722F37)';
    } else {
      btn.classList.remove('cd-vi-recording');
      btn.style.background = 'var(--paper, #fff)';
      btn.style.color = 'var(--ink, #0a0a0a)';
      btn.style.borderColor = 'var(--ink, #0a0a0a)';
      btn.querySelector('.cd-vi-text').textContent = btn.dataset.label || 'Dictate';
    }
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
      onFallback();
      return null;
    }

    var finalChunks = [];
    var interim = '';
    var startMark = field.value.length;
    var stopped = false;

    sr.onresult = function (event) {
      interim = '';
      for (var i = event.resultIndex; i < event.results.length; i++) {
        var r = event.results[i];
        if (r.isFinal) {
          finalChunks.push((r[0].transcript || '').trim());
        } else {
          interim += r[0].transcript;
        }
      }
      // Live preview: keep the finalised pieces in the field, append interim.
      var preview = finalChunks.join(' ');
      var orig = field.value.slice(0, startMark);
      var sep = (orig && !/\s$/.test(orig)) ? ' ' : '';
      field.value = orig + sep + (preview ? preview + ' ' : '') + interim;
      field.dispatchEvent(new Event('input', { bubbles: true }));
    };
    sr.onerror = function (e) {
      stopped = true;
      // If the browser denied permission OR the network/no-speech error
      // fires, fall back to Whisper. If the user just stopped (aborted),
      // accept what we have.
      if (e.error === 'no-speech' || e.error === 'audio-capture' || e.error === 'service-not-allowed' || e.error === 'network') {
        onFallback();
      } else {
        status.textContent = '';
        setRecording(btn, status, false);
        onDone();
      }
    };
    sr.onend = function () {
      if (stopped) return;
      setRecording(btn, status, false);
      status.textContent = '';
      onDone();
    };

    try {
      sr.start();
      setRecording(btn, status, true);
      return {
        stop: function () { stopped = true; try { sr.stop(); } catch (e) {} setRecording(btn, status, false); status.textContent = ''; }
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

    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(function (s) {
        stream = s;
        rec = new MediaRecorder(s, { mimeType: mime });
        rec.ondataavailable = function (e) { if (e.data && e.data.size > 0) chunks.push(e.data); };
        rec.onstop = function () {
          if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
          if (hardStop) clearTimeout(hardStop);
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
              status.textContent = 'Network error. Type the note.';
              status.style.color = 'var(--wine, #722F37)';
              setRecording(btn, status, false);
              onDone();
            });
        };
        rec.start();
        setRecording(btn, status, true);
        hardStop = setTimeout(function () { if (rec.state === 'recording') rec.stop(); }, MAX_RECORD_MS);
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
