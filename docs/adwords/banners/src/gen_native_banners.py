import base64, os, random

FONTS = r'c:/Users/James/OneDrive/Documents/_Mullover.ai/counsel-day-complete/fonts'
OUT = os.path.dirname(os.path.abspath(__file__))

def b64(fn):
    return base64.b64encode(open(os.path.join(FONTS, fn), 'rb').read()).decode()

FF = f"""
@font-face {{ font-family:'Newsreader'; font-style:normal; font-weight:400 500;
  src:url(data:font/woff2;base64,{b64('newsreader-cY9AfjOCX1hbuyalUrK4397yjA.woff2')}) format('woff2'); }}
@font-face {{ font-family:'Newsreader'; font-style:italic; font-weight:400 500;
  src:url(data:font/woff2;base64,{b64('newsreader-cY9CfjOCX1hbuyalUrK439vCjohC.woff2')}) format('woff2'); }}
@font-face {{ font-family:'SourceSerif'; font-style:normal; font-weight:400 500;
  src:url(data:font/woff2;base64,{b64('sourceserif4-vEFI2_tTDB4M7-auWDN0ahZJW1gb8tc.woff2')}) format('woff2'); }}
@font-face {{ font-family:'Geist'; font-style:normal; font-weight:400 600;
  src:url(data:font/woff2;base64,{b64('geist-gyByhwUxId8gMEwcGFU.woff2')}) format('woff2'); }}
"""

WINE='#722F37'; WINE_DEEP='#5a242c'; INK='#1c1a17'; SOFT='#3a3530'; MUTED='#6b635a'
GREEN='#0E9F4C'; RED='#C0392B'; RULE='#e8e6e1'

# Two believable vote lanes · deterministic (seeded), mostly-green lane A
# swaying early, mixed lane B ending red. 26 ticks each.
rng = random.Random(7)
def lane(colors_bias_green, flip_tail_red):
    ticks = []
    for i in range(26):
        p_green = colors_bias_green + (i / 26) * (0.35 if not flip_tail_red else -0.55)
        ticks.append(GREEN if rng.random() < p_green else RED)
    if flip_tail_red:
        ticks[-3:] = [RED, RED, RED]
    else:
        ticks[-4:] = [GREEN] * 4
    return ticks

def ticks_svg(y, colors):
    parts = []
    x = 6
    for c in colors:
        parts.append(f'<rect x="{x}" y="{y}" width="3" height="20" fill="{c}"/>')
        x += 12.6
    return ''.join(parts), x

laneA = lane(0.62, False)
laneB = lane(0.55, True)
ta, xa = ticks_svg(16, laneA)
tb, xb = ticks_svg(74, laneB)

svg = f'''<svg width="470" height="118" viewBox="0 0 470 118" xmlns="http://www.w3.org/2000/svg">
<text x="6" y="9" font-family="Geist" font-size="8.5" letter-spacing="1.4" fill="{MUTED}">DAY 01 &#183; QUESTION POSED</text>
<text x="464" y="9" text-anchor="end" font-family="Geist" font-size="8.5" letter-spacing="1.4" fill="{WINE}">DAY 30 &#183; VERDICT</text>
{ta}
<rect x="{xa+6}" y="17" width="34" height="18" fill="{GREEN}"/>
<text x="{xa+23}" y="30" text-anchor="middle" font-family="Geist" font-size="9.5" font-weight="600" letter-spacing="1" fill="#fff">YES</text>
<text x="{xa+48}" y="32" font-family="Newsreader" font-size="24" fill="{GREEN}">Yes</text>
{tb}
<rect x="{xb+6}" y="75" width="30" height="18" fill="{RED}"/>
<text x="{xb+21}" y="88" text-anchor="middle" font-family="Geist" font-size="9.5" font-weight="600" letter-spacing="1" fill="#fff">NO</text>
<text x="{xb+44}" y="90" font-family="Newsreader" font-style="italic" font-size="21" fill="{RED}">Lean No</text>
<line x1="6" y1="52" x2="464" y2="52" stroke="{RULE}" stroke-width="1" stroke-dasharray="2 4"/>
<text x="6" y="112" font-family="Geist" font-size="8.5" letter-spacing="1.2" fill="{MUTED}">TWO PARTNERS &#183; SEALED FROM EACH OTHER &#183; BOTH VERDICTS OPEN TOGETHER</text>
</svg>'''

desktop = f'''<!doctype html><meta charset="utf-8">
<style>{FF} html,body{{margin:0;padding:0}}</style>
<body>
<div style="width:1108px;height:278px;background:#fff;border:1px solid {WINE};overflow:hidden;display:flex;align-items:stretch">
  <div style="flex:0 0 560px;padding:30px 0 26px 38px;display:flex;flex-direction:column;justify-content:space-between">
    <div>
      <div style="font-family:Geist;font-size:11px;letter-spacing:.18em;color:{WINE};margin-bottom:14px">FROM THE MAKER OF CALCULATE.CO.NZ</div>
      <div style="font-family:Newsreader;font-weight:400;font-size:46px;line-height:1.04;letter-spacing:-.015em;color:{INK}">The numbers say you can.<br><span style="font-style:italic;color:{WINE}">Should you?</span></div>
    </div>
    <div style="font-family:SourceSerif;font-size:15.5px;line-height:1.5;color:{SOFT};max-width:520px">For the questions a spreadsheet can&#8217;t settle &#183; one private vote each evening, sealed from each other, and a written verdict that reads the whole arc.</div>
  </div>
  <div style="flex:0 0 1px;background:{RULE};margin:26px 0"></div>
  <div style="flex:1;padding:26px 34px 22px;display:flex;flex-direction:column;justify-content:space-between">
    <div>{svg}</div>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-top:6px">
      <span style="font-family:Geist;font-weight:600;font-size:13.5px;letter-spacing:.04em;color:#fff;background:{WINE};padding:13px 20px;white-space:nowrap">Start free &#183; no card required</span>
      <span style="text-align:right">
        <span style="display:block;font-family:Newsreader;font-size:21px;color:{INK}">Counsel<span style="font-style:italic;color:{WINE}">.day</span></span>
        <span style="display:block;font-family:Geist;font-size:10.5px;color:{MUTED};margin-top:3px">$4.99 USD per decision after your first</span>
      </span>
    </div>
  </div>
</div>'''

mobile = f'''<!doctype html><meta charset="utf-8">
<style>{FF} html,body{{margin:0;padding:0}}</style>
<body>
<div style="width:364px;height:90px;background:#fff;border:1px solid {WINE};overflow:hidden;display:flex;align-items:center">
  <div style="flex:1;min-width:0;padding:0 0 0 14px">
    <div style="font-family:Newsreader;font-size:17.5px;line-height:1.15;letter-spacing:-.01em;color:{INK}">The numbers say you can. <span style="font-style:italic;color:{WINE}">Should you?</span></div>
    <div style="font-family:Geist;font-size:9.5px;letter-spacing:.06em;color:{MUTED};margin-top:5px">SEALED DAILY VOTES &#183; ONE VERDICT &#183; COUNSEL.DAY</div>
  </div>
  <div style="flex:0 0 auto;padding:0 12px 0 12px">
    <span style="display:inline-block;font-family:Geist;font-weight:600;font-size:11px;color:#fff;background:{WINE};padding:9px 13px">Free &#8594;</span>
  </div>
</div>'''

open(os.path.join(OUT,'banner-desktop.html'),'w',encoding='utf-8').write(desktop)
open(os.path.join(OUT,'banner-mobile.html'),'w',encoding='utf-8').write(mobile)
print('html written', len(desktop)//1024, 'KB /', len(mobile)//1024, 'KB')
