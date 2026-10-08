'use strict';
/* تحضيرُ الطابور — الواجهة. البياناتُ في جدول Google، والمحرّكُ (Apps Script) يجيب بـJSON */
var API = 'https://script.google.com/macros/s/AKfycbyrGD6_YuWOT439G1RxY-GVze0-mn0u6XuQCoSks_L4bBHRyUKI89ODTdBFUq3r2zSnqg/exec';

var K = '';           // مفتاحُ المسؤول — من رابطه، ويُحفظ في الجهاز
var S = null;         // آخرُ حالةٍ من المحرّك
var LETTER = '';      // الحرفُ المختار ('' = الكلّ)
var VIEW = 'mark';    // 'mark' التحضير · 'report' التقرير
var DATE = '';        // تاريخُ التقرير ('' = اليوم)
var inflight = {};    // أسماءٌ أُرسل تحضيرُها ولم يصل الردّ
var undoAfter = {};   // تراجعٌ ضُغط قبل وصول الردّ
var toastTimer = null, undoName = '';
var pollTimer = null, lastTouch = 0, wakeLock = null;

(function () {
  var m = location.search.match(/[?&]k=([^&#]+)/);
  try {
    if (m) { K = decodeURIComponent(m[1]); localStorage.setItem('tabour_k', K); }
    else K = localStorage.getItem('tabour_k') || '';
  } catch (e) {
    if (m) K = decodeURIComponent(m[1]);
  }
})();

function $(id) { return document.getElementById(id); }
function esc(s) {
  return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
}

/* الحروف: أوّلُ حرفٍ من الاسم الأوّل · وأوّلُ حرفٍ من اسم العائلة بعد «ال» */
var ORDER = 'ابتثجحخدذرزسشصضطظعغفقكلمنهوي';
function norm1(c) { return c.replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه'); }
function words(n) { return String(n).trim().split(/\s+/); }
function firstL(n) { return norm1((words(n)[0] || '').charAt(0)); }
function lastL(n) {
  var w = words(n);
  if (w.length < 2) return '';
  var t = w[w.length - 1];
  if (t.indexOf('ال') === 0 && t.length > 3) t = t.slice(2);
  return norm1(t.charAt(0));
}
function shown(L) { return L === 'ا' ? 'أ' : L; }

function fmt(d, cal) {
  try {
    return new Intl.DateTimeFormat('ar-SA-u-ca-' + cal, {
      weekday: cal === 'islamic-umalqura' ? 'long' : undefined, day: 'numeric', month: 'long', year: 'numeric'
    }).format(new Date(d + 'T12:00:00'));
  } catch (e) { return d; }
}

function api(action, params) {
  var q = 'api=' + action + '&k=' + encodeURIComponent(K);
  Object.keys(params || {}).forEach(function (p) { q += '&' + p + '=' + encodeURIComponent(params[p]); });
  return fetch(API + '?' + q, { cache: 'no-store' }).then(function (r) { return r.json(); });
}

function refresh() {
  return api('state', DATE ? { date: DATE } : {}).then(function (d) {
    if (d.error) { fatal(d.error); return; }
    S = d.state;
    render(false);
    schedule();
  }).catch(function () { netFail(); schedule(); });
}
function schedule() {
  clearTimeout(pollTimer);
  var fast = S && S.open && S.canAct && !document.hidden;
  pollTimer = setTimeout(refresh, fast ? 5000 : 60000);
}

/* الرسم — والتحديثُ الآليُّ لا يحرّك الأزرارَ تحت إصبعٍ لمس الشاشةَ للتوّ */
function render(force) {
  if (!S) return;
  if (!force && Date.now() - lastTouch < 1200) { setTimeout(function () { render(false); }, 1300); return; }
  $('who').textContent = S.canAct ? 'شاشة ' + S.who : 'للاطّلاع فقط';
  $('day').textContent = fmt(S.date, 'islamic-umalqura') + ' — ' + fmt(S.date, 'gregory');
  var marking = S.open && S.canAct && VIEW === 'mark' && S.date === S.today;
  $('app').className = marking ? '' : 'wide';
  $('app').innerHTML = marking ? markHtml() : reportHtml();
  wake(marking);
}

function remaining() {
  var gone = {};
  S.present.forEach(function (p) { gone[p.name] = 1; });
  Object.keys(inflight).forEach(function (n) { gone[n] = 1; });
  return S.names.filter(function (n) { return !gone[n]; });
}

function markHtml() {
  var left = remaining(), leftSet = {}, exc = {};
  left.forEach(function (n) { leftSet[n] = 1; });
  S.excused.forEach(function (x) { exc[x.name] = x.by; });
  var h = '<div class="status"><span class="count">حضر ' + (S.names.length - left.length) + ' من ' + S.names.length + '</span>' +
    '<span class="muted">التحضير حتى ' + S.end + '</span></div>';

  h += '<div class="letters"><button class="letter all' + (LETTER === '' ? ' on' : '') + '" data-l="">👥 الكلّ<span class="n">' + left.length + '</span></button>';
  ORDER.split('').forEach(function (L) {
    var all = S.names.filter(function (n) { return firstL(n) === L || lastL(n) === L; });
    if (!all.length) return;
    var rem = all.filter(function (n) { return leftSet[n]; }).length;
    h += '<button class="letter' + (LETTER === L ? ' on' : '') + (rem ? '' : ' done') + '" data-l="' + L + '">' + shown(L) + '<span class="n">' + rem + '</span></button>';
  });
  h += '</div>';

  var first = [], last = [];
  if (LETTER === '') first = left;
  else left.forEach(function (n) {
    if (firstL(n) === LETTER) first.push(n);
    else if (lastL(n) === LETTER) last.push(n);
  });
  h += '<div class="names">';
  if (!first.length && !last.length) h += '<div class="empty">' + (left.length ? 'لا أحد باقٍ تحت هذا الحرف ✓' : 'حضر الجميع ✓') + '</div>';
  first.forEach(function (n) { h += nameBtn(n, exc); });
  if (last.length) {
    h += '<div class="sep">— ومن اسم العائلة —</div>';
    last.forEach(function (n) { h += nameBtn(n, exc); });
  }
  h += '</div>';

  if (S.present.length) {
    h += '<section class="green"><h2>حضر (' + S.present.length + ')</h2>' + S.present.slice().reverse().map(function (p) {
      return '<div class="item"><span>' + esc(p.name) + '<small>' + p.time + (p.by ? ' · رصده ' + esc(p.by) : '') + '</small></span></div>';
    }).join('') + '</section>';
  }
  h += '<button class="toggle" data-v="report">📊 التقرير</button>';
  return h;
}

function nameBtn(n, exc) {
  var w = words(n);
  return '<button class="name" data-n="' + esc(n) + '"><b>' + esc(w[0]) + '</b> ' + esc(w.slice(1).join(' ')) +
    (n in exc ? '<span class="tag">معذور</span>' : '') + '</button>';
}

function reportHtml() {
  var A = S.canAct, h = '';
  if (S.date === S.today) {
    if (S.open && A) h += '<button class="toggle" data-v="mark">↩ العودة إلى التحضير</button>';
    else if (S.now < S.start) h += '<div class="closed">يبدأ التحضير الساعة ' + S.start + '</div>';
    else if (!S.open) h += '<div class="closed">انتهى الطابور · حضر ' + S.present.length + ' · لم يحضر ' + S.absent.length + '</div>';
  }
  h += '<div class="nav"><button data-d="-1">→ اليوم السابق</button>' +
    (S.date < S.today ? '<button data-d="1">اليوم التالي ←</button>' : '') +
    '<button class="print" data-print="1">طباعة</button></div>';
  h += '<div class="chips"><div class="chip">حضر<b>' + S.present.length + '</b></div><div class="chip">لم يحضر<b>' + S.absent.length +
    '</b></div><div class="chip">معذور<b>' + S.excused.length + '</b></div><div class="chip">الكلّ<b>' + S.names.length + '</b></div></div>';

  h += '<section class="red"><h2>لم يحضر الطابور (' + S.absent.length + ')</h2>' + (S.absent.length ? S.absent.map(function (n) {
    return '<div class="item"><span>' + esc(n) + '</span>' + (A ? '<button class="act" data-x="1" data-n="' + esc(n) + '">معذور</button>' : '') + '</div>';
  }).join('') : '<p class="muted">لا أحد</p>') + '</section>';

  if (S.excused.length) {
    h += '<section class="amber"><h2>معذور (' + S.excused.length + ')</h2>' + S.excused.map(function (x) {
      return '<div class="item"><span>' + esc(x.name) + (x.by ? '<small>عذره ' + esc(x.by) + '</small>' : '') + '</span>' +
        (A ? '<button class="act" data-x="0" data-n="' + esc(x.name) + '">إلغاء العذر</button>' : '') + '</div>';
    }).join('') + '</section>';
  }

  h += '<section class="green"><h2>حضر (' + S.present.length + ')</h2>' + (S.present.length ? S.present.map(function (p) {
    return '<div class="item"><span>' + esc(p.name) + '<small>' + p.time + (p.by ? ' · رصده ' + esc(p.by) : '') + '</small></span>' +
      (A ? '<button class="act" data-u="1" data-n="' + esc(p.name) + '">إلغاء التحضير</button>' : '') + '</div>';
  }).join('') : '<p class="muted">لا أحد</p>') + '</section>';
  return h;
}

/* ============================== الأفعال ============================== */

function mark(n) {
  inflight[n] = 1;
  render(true);
  toast('✓ حضّرتَ ' + n, n);
  api('mark', { name: n }).then(function (d) {
    delete inflight[n];
    if (d.error) { delete undoAfter[n]; toast(d.error); refresh(); return; }
    S = d.state;
    var r = d.result || {};
    if (r.state === 'already') { delete undoAfter[n]; toast('حضّره ' + (r.by || 'غيرُك') + ' الساعة ' + r.time); }
    else if (r.state === 'closed') { delete undoAfter[n]; toast('انتهى وقتُ التحضير'); }
    else if (undoAfter[n]) { delete undoAfter[n]; unmark(n); return; }
    render(true);
  }).catch(function () {
    delete inflight[n];
    delete undoAfter[n];
    toast('تعذّر الاتصال — اضغط الاسم مرّةً أخرى');
    render(true);
  });
}

function unmark(n) {
  return api('unmark', { name: n }).then(function (d) {
    if (d.state) S = d.state;
    render(true);
    toast('أُلغي تحضيرُ ' + n);
  }).catch(function () { toast('تعذّر الاتصال — لم يُلغَ التحضير'); });
}

function act(kind, n, extra, btn) {
  btn.disabled = true;
  var p = { name: n };
  if (DATE) p.date = DATE;
  Object.keys(extra).forEach(function (k) { p[k] = extra[k]; });
  api(kind, p).then(function (d) {
    if (d.error) toast(d.error);
    if (d.state) S = d.state;
    render(true);
  }).catch(function () { btn.disabled = false; toast('تعذّر الاتصال'); });
}

function shiftDay(step) {
  var t = new Date(S.date + 'T12:00:00');
  t.setDate(t.getDate() + step);
  var d = t.toISOString().slice(0, 10);
  if (d > S.today) return;
  DATE = d === S.today ? '' : d;
  VIEW = 'report';
  $('app').innerHTML = '<p class="muted center">جارٍ التحميل…</p>';
  refresh();
}

function toast(msg, undoFor) {
  clearTimeout(toastTimer);
  $('toastText').textContent = msg;
  undoName = undoFor || '';
  $('undo').hidden = !undoFor;
  $('toast').hidden = false;
  toastTimer = setTimeout(hideToast, undoFor ? 10000 : 4000);
}
function hideToast() { clearTimeout(toastTimer); $('toast').hidden = true; undoName = ''; }

function fatal(msg) {
  $('who').textContent = '';
  $('app').innerHTML = '<div class="closed">' + esc(msg) + '</div><p class="muted center">افتح التطبيق من رابطك الخاصّ.</p>';
}
function netFail() {
  if (!S) $('app').innerHTML = '<div class="closed">تعذّر الاتصال — تأكّد من الإنترنت</div>';
  else if ($('toast').hidden) toast('تعذّر الاتصال — يُعاد تلقائيّاً');
}

/* الشاشةُ تبقى مضاءةً وقتَ التحضير */
function wake(on) {
  if (!('wakeLock' in navigator)) return;
  if (on && !wakeLock && !document.hidden) {
    navigator.wakeLock.request('screen').then(function (w) {
      wakeLock = w;
      w.addEventListener('release', function () { wakeLock = null; });
    }).catch(function () {});
  } else if (!on && wakeLock) {
    wakeLock.release();
    wakeLock = null;
  }
}

/* ============================== التشغيل ============================== */

document.addEventListener('pointerdown', function () { lastTouch = Date.now(); }, true);
$('app').addEventListener('click', function (e) {
  var b = e.target.closest('button');
  if (!b) return;
  if (b.hasAttribute('data-l')) { LETTER = b.getAttribute('data-l'); render(true); return; }
  if (b.hasAttribute('data-v')) { VIEW = b.getAttribute('data-v'); window.scrollTo(0, 0); render(true); return; }
  if (b.hasAttribute('data-d')) { shiftDay(Number(b.getAttribute('data-d'))); return; }
  if (b.hasAttribute('data-print')) { window.print(); return; }
  var n = b.getAttribute('data-n');
  if (!n) return;
  if (b.classList.contains('name')) mark(n);
  else if (b.hasAttribute('data-x')) act('excuse', n, { on: b.getAttribute('data-x') }, b);
  else if (b.hasAttribute('data-u')) act('unmark', n, {}, b);
});
$('undo').addEventListener('click', function () {
  var n = undoName;
  hideToast();
  if (!n) return;
  if (inflight[n]) { undoAfter[n] = 1; delete inflight[n]; render(true); return; }
  unmark(n);
});
document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(); });

if (!K) fatal('لا يوجد مفتاح'); else refresh();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});
