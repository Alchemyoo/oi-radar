#!/usr/bin/env python3
"""把 Hyperliquid 快照里的强平簇生成 AICoin 主图指标脚本（HL_LIQ_AICoin_<SYM>.txt）。

用法: python3 tools/gen_hl_liq_aicoin.py --coin BTC --top 5
输出: 标准输出（或 --output 指定文件）
"""
import argparse, json, time
from pathlib import Path

def clusters(holders, side, top):
    arr = sorted([h for h in holders if h.get('lq') and h.get('s') == side], key=lambda h: h['lq'])
    if not arr:
        return []
    n = min(8, max(3, len(arr) // 2))
    out = []
    for i in range(n):
        seg = arr[int(i * len(arr) / n):int((i + 1) * len(arr) / n)]
        if not seg:
            continue
        v = sum(x['v'] for x in seg)
        mid = (seg[0]['lq'] + seg[-1]['lq']) / 2
        out.append({'lo': seg[0]['lq'], 'hi': seg[-1]['lq'], 'mid': mid, 'v': v, 'n': len(seg)})
    return out

def fmt(v):
    return f"{v:.1f}" if v >= 100 else f"{v:.4f}"

def money(v):
    return f"${v/1e6:.0f}M" if v >= 1e6 else f"${v/1e3:.0f}K"

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cache', default='hl-whale-cache.json')
    ap.add_argument('--coin', default='BTC')
    ap.add_argument('--top', type=int, default=5, help='每侧保留的簇数量（离现价最近的）')
    ap.add_argument('--output')
    a = ap.parse_args()

    d = json.loads(Path(a.cache).read_text(encoding='utf8'))
    c = next((x for x in d['coins'] if x['coin'] == a.coin), None)
    if not c:
        raise SystemExit(f'快照里没有 {a.coin}')
    mark = c['mark']
    holders = c['holders']

    longs = [x for x in clusters(holders, 'L', a.top) if x['mid'] < mark][-a.top:]
    shorts = [x for x in clusters(holders, 'S', a.top) if x['mid'] > mark][:a.top]
    longs = list(reversed(longs))          # 由近到远（价格从高到低）
    shorts = list(shorts)                  # 由近到远（价格从低到高）

    gen = time.strftime('%Y-%m-%d %H:%M', time.gmtime(d['generatedAt'] / 1000))
    lines = []
    w = lines.append
    w('// @version=2')
    w('// ============================================================================')
    w(f'// Hyperliquid 巨鲸强平簇 · AICoin 主图指标（{a.coin}）')
    w('//')
    w('// 数据来源：Hyperliquid 公开 API（账户价值前 1500 名）每小时快照')
    w(f'// 生成时间：{gen} UTC  |  快照现价：{mark}')
    w('//')
    w('// 两层结构：')
    w('//   静态层 = 真实巨鲸强平簇（价格线，图例里带金额；价格接近时弹出文字提示）')
    w('//   动态层 = 按杠杆档位从摆动高/低推算的强平带（随行情移动，纯计算）')
    w('//')
    w('// 说明：AICoin 脚本不能联网，静态簇是"写死"的常量。')
    w('// 换币 / 刷新：在仓库根目录跑')
    w(f'//   python3 tools/gen_hl_liq_aicoin.py --coin {a.coin} --top {a.top} --output /var/minis/shared/oi-radar/aicoin/HL_LIQ_AICoin_{a.coin}.txt')
    w('// 然后把新文件内容整份粘贴覆盖本指标即可。')
    w('// ============================================================================')
    w('')
    w('// ===================== 参数 =====================')
    w('SWING_LEN = 20          // 摆动高/低点长度（动态层锚点）')
    w('LEV_A = 10              // 动态层杠杆档 1')
    w('LEV_B = 25              // 动态层杠杆档 2')
    w('LEV_C = 50              // 动态层杠杆档 3')
    w('NEAR_PCT = 0.015        // 价格距离静态簇多少（比例）时弹提示')
    w('SHOW_DYN = 1            // 1=显示动态杠杆带，0=只显示静态簇')
    w('')
    w(f'// ===================== 静态层：Hyperliquid 真实强平簇（{a.coin}，{gen} UTC） =====================')
    w('// 空单强平簇（现价上方）：价格涨到这里，空头被强平')
    for i, x in enumerate(shorts, 1):
        w(f"LQ_S{i} = {fmt(x['mid'])}".ljust(46) + f"// {fmt(x['lo'])}–{fmt(x['hi'])}  {money(x['v'])}  {x['n']}户")
    w('// 多单强平簇（现价下方）：价格跌到这里，多头被强平')
    for i, x in enumerate(longs, 1):
        w(f"LQ_L{i} = {fmt(x['mid'])}".ljust(46) + f"// {fmt(x['lo'])}–{fmt(x['hi'])}  {money(x['v'])}  {x['n']}户")
    w('')
    w('// ===================== 基础数据 =====================')
    w('trv = max(high - low, abs(high - close[1]), abs(low - close[1]))')
    w('atrv = ema(trv, 14)')
    w('barCnt = 0')
    w('barCnt := nz(barCnt[1], 0) + 1')
    w('')
    w('// ===================== 动态层：摆动高/低（锚点） =====================')
    w('pivHighOk = 0')
    w('if (barCnt > 2 * SWING_LEN + 1) {')
    w('    pivHighOk := 1')
    w('}')
    w('for (phi = 1; phi < SWING_LEN + 1; phi++) {')
    w('    if (high[SWING_LEN - phi] >= high[SWING_LEN]) {')
    w('        pivHighOk := 0')
    w('    }')
    w('    if (high[SWING_LEN + phi] >= high[SWING_LEN]) {')
    w('        pivHighOk := 0')
    w('    }')
    w('}')
    w('pivLowOk = 0')
    w('if (barCnt > 2 * SWING_LEN + 1) {')
    w('    pivLowOk := 1')
    w('}')
    w('for (plo = 1; plo < SWING_LEN + 1; plo++) {')
    w('    if (low[SWING_LEN - plo] <= low[SWING_LEN]) {')
    w('        pivLowOk := 0')
    w('    }')
    w('    if (low[SWING_LEN + plo] <= low[SWING_LEN]) {')
    w('        pivLowOk := 0')
    w('    }')
    w('}')
    w('swingHigh = 0.0')
    w('swingHigh := nz(swingHigh[1], 0.0)')
    w('swingLow = 0.0')
    w('swingLow := nz(swingLow[1], 0.0)')
    w('if (pivHighOk == 1) {')
    w('    swingHigh := high[SWING_LEN]')
    w('}')
    w('if (pivLowOk == 1) {')
    w('    swingLow := low[SWING_LEN]')
    w('}')
    w('')
    w('// 杠杆强平估算：多头 ≈ 锚点 × (1 - 1/杠杆)，空头 ≈ 锚点 × (1 + 1/杠杆)')
    w('dynLongA = nan')
    w('dynLongB = nan')
    w('dynLongC = nan')
    w('dynShortA = nan')
    w('dynShortB = nan')
    w('dynShortC = nan')
    w('if (SHOW_DYN == 1 and swingLow > 0 and swingHigh > 0) {')
    w('    dynLongA := swingLow * (1.0 - 1.0 / LEV_A)')
    w('    dynLongB := swingLow * (1.0 - 1.0 / LEV_B)')
    w('    dynLongC := swingLow * (1.0 - 1.0 / LEV_C)')
    w('    dynShortA := swingHigh * (1.0 + 1.0 / LEV_A)')
    w('    dynShortB := swingHigh * (1.0 + 1.0 / LEV_B)')
    w('    dynShortC := swingHigh * (1.0 + 1.0 / LEV_C)')
    w('}')
    w('')
    w('// ===================== 绘图：静态簇（图例带金额） =====================')
    for i, x in enumerate(shorts, 1):
        w(f"plot(LQ_S{i}, title='空簇{i} {money(x['v'])}', color='rgba(232,54,95,0.85)', lineWidth=2, lineDash=[0], display=true)")
    for i, x in enumerate(longs, 1):
        w(f"plot(LQ_L{i}, title='多簇{i} {money(x['v'])}', color='rgba(0,168,157,0.85)', lineWidth=2, lineDash=[0], display=true)")
    w('')
    w('// ===================== 绘图：动态杠杆带 =====================')
    w("plot(dynLongA, title='多强平10x', color='rgba(0,168,157,0.45)', lineWidth=1, lineDash=[4,2], display=true)")
    w("plot(dynLongB, title='多强平25x', color='rgba(0,168,157,0.30)', lineWidth=1, lineDash=[2,3], display=true)")
    w("plot(dynLongC, title='多强平50x', color='rgba(0,168,157,0.22)', lineWidth=1, lineDash=[1,3], display=true)")
    w("plot(dynShortA, title='空强平10x', color='rgba(232,54,95,0.45)', lineWidth=1, lineDash=[4,2], display=true)")
    w("plot(dynShortB, title='空强平25x', color='rgba(232,54,95,0.30)', lineWidth=1, lineDash=[2,3], display=true)")
    w("plot(dynShortC, title='空强平50x', color='rgba(232,54,95,0.22)', lineWidth=1, lineDash=[1,3], display=true)")
    w('')
    w('// ===================== 接近提示（价格进入簇 ±NEAR_PCT 时弹文字） =====================')
    for i, x in enumerate(shorts, 1):
        w(f"nearS{i} = abs(close - LQ_S{i}) / close <= NEAR_PCT")
        w(f"plotText(nearS{i}, title='接近空簇{i}', text='空簇{i} {money(x['v'])}', refSeries=LQ_S{i}, bgColor='rgba(232,54,95,0.92)', color='white', fontSize=10, placement='top', display=true)")
    for i, x in enumerate(longs, 1):
        w(f"nearL{i} = abs(close - LQ_L{i}) / close <= NEAR_PCT")
        w(f"plotText(nearL{i}, title='接近多簇{i}', text='多簇{i} {money(x['v'])}', refSeries=LQ_L{i}, bgColor='rgba(0,168,157,0.92)', color='black', fontSize=10, placement='bottom', display=true)")
    w('')
    w('// ===================== 警报 =====================')
    nearestShort = shorts[0]['mid'] if shorts else mark
    nearestLong = longs[0]['mid'] if longs else mark
    w(f"alertcondition(close > {fmt(nearestShort)} and close[1] <= {fmt(nearestShort)}, title='进入最近空头爆仓簇（上方第一档）', direction='buy')")
    w(f"alertcondition(close < {fmt(nearestLong)} and close[1] >= {fmt(nearestLong)}, title='进入最近多头爆仓簇（下方第一档）', direction='sell')")
    w("alertcondition(nearS1 == 1 and nearS1[1] == 0, title='逼近空头爆仓簇', direction='buy')")
    w("alertcondition(nearL1 == 1 and nearL1[1] == 0, title='逼近多头爆仓簇', direction='sell')")

    text = '\n'.join(lines) + '\n'
    if a.output:
        Path(a.output).write_text(text, encoding='utf8')
        print(f"wrote {a.output}  ({len(lines)} lines)  shorts={len(shorts)} longs={len(longs)}")
    else:
        print(text)

if __name__ == '__main__':
    main()
