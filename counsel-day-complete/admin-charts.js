/* admin-charts.js · shared D3 chart primitives for every /admin-*.html
 *
 * Why this exists: the admin section was on Chart.js (8 charts across
 * 4 pages). Operator feedback was that the running total mattered as
 * much as the daily rate, and the canvases were noisy. This module
 * replaces every admin chart with a side-by-side pair · the rate on
 * the left, the cumulative on the right · drawn in D3 with the
 * admin palette (#2563eb accent, #047857 green, #b91c1c red).
 *
 * Public API (everything hangs off window.CdChart):
 *
 *   CdChart.dailyLine(el, opts)        line, paired cumulative
 *   CdChart.dailyBars(el, opts)        bars (single or stacked), paired cumulative
 *   CdChart.donut(el, opts)            donut, no pairing
 *   CdChart.funnelBars(el, opts)       horizontal funnel bars, no pairing
 *
 * Common opts:
 *   data           [{date|label, value} | {date, series: [{label, value, color}]}]
 *   cumulative     true|false (default true for line/bars) · pairs a cumulative chart
 *   color          accent color for single-series charts
 *   yLabel         y-axis label suffix (e.g. "USD", "users")
 *   yFormat        d3 format string (default ",")
 *   legend         array of {label, color} for stacked series
 *
 * The pairing is implemented by replacing the host element's content
 * with a flex row of two charts. On mobile (max-width: 720px) the
 * row stacks via the .cd-chart-pair CSS. Every chart resizes to its
 * container via a ResizeObserver, so window resize / sidebar collapse
 * just works.
 */
(function () {
  'use strict';

  if (typeof d3 === 'undefined') {
    console.warn('[CdChart] d3 not loaded · charts will not render');
    return;
  }

  // ---- palette (matches admin-shell.css :root vars) -----------------
  var PAL = {
    ink:        '#0b1a2b',
    soft:       '#364556',
    muted:      '#6b7a90',
    grid:       '#e4e8f0',
    accent:     '#2563eb',
    accentSoft: '#e7efff',
    green:      '#047857',
    yellow:     '#b45309',
    red:        '#b91c1c',
    grey:       '#9ca3af',
  };
  var PALETTE_ROTATE = [PAL.accent, PAL.green, PAL.yellow, PAL.red, PAL.grey, '#7c3aed', '#0891b2'];

  // ---- helpers ------------------------------------------------------
  function parseDate(d) {
    if (d instanceof Date) return d;
    if (typeof d === 'string') return new Date(d);
    return new Date(d);
  }

  function fmtTick(yFormat) {
    var f = d3.format(yFormat || ',');
    return function (v) {
      if (Math.abs(v) >= 1000000) return d3.format('.2s')(v).replace('G', 'B');
      if (Math.abs(v) >= 10000)   return d3.format('.1s')(v).replace('G', 'B');
      return f(v);
    };
  }

  function cumulativeSeries(arr) {
    var total = 0;
    return arr.map(function (d) { total += (d.value || 0); return { date: d.date, value: total }; });
  }

  function stackedCumulative(arr) {
    // Each row already has {date, series:[{label,value,color}]}.
    // Cumulative version sums each series across rows independently.
    if (!arr.length || !arr[0].series) return arr;
    var labels = arr[0].series.map(function (s) { return s.label; });
    var colors = arr[0].series.map(function (s) { return s.color; });
    var totals = labels.map(function () { return 0; });
    return arr.map(function (row) {
      var s = row.series.map(function (e, i) {
        totals[i] += (e.value || 0);
        return { label: e.label, value: totals[i], color: e.color || colors[i] };
      });
      return { date: row.date, series: s };
    });
  }

  function ensureHostStructure(el, layout) {
    // layout: 'pair' | 'single'
    el.classList.add('cd-chart-host');
    el.innerHTML = '';
    if (layout === 'pair') {
      el.innerHTML =
        '<div class="cd-chart-pair">' +
          '<div class="cd-chart-slot" data-slot="rate"><div class="cd-chart-sub-title">PER DAY</div><div class="cd-chart-svg"></div></div>' +
          '<div class="cd-chart-slot" data-slot="cum"><div class="cd-chart-sub-title">CUMULATIVE</div><div class="cd-chart-svg"></div></div>' +
        '</div>';
    } else {
      el.innerHTML = '<div class="cd-chart-single"><div class="cd-chart-svg"></div></div>';
    }
  }

  function svgInto(node, w, h) {
    var existing = node.querySelector('svg');
    if (existing) existing.remove();
    var svg = d3.select(node)
      .append('svg')
      .attr('viewBox', '0 0 ' + w + ' ' + h)
      .attr('preserveAspectRatio', 'xMidYMid meet')
      .attr('width', '100%')
      .attr('height', '100%')
      .style('display', 'block');
    return svg;
  }

  function tooltip() {
    var t = document.querySelector('.cd-chart-tooltip');
    if (!t) {
      t = document.createElement('div');
      t.className = 'cd-chart-tooltip';
      t.style.cssText = 'position: fixed; pointer-events: none; background: #0b1a2b; color: #fff; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 11px; padding: 6px 9px; line-height: 1.4; border-radius: 2px; z-index: 9999; opacity: 0; transition: opacity 100ms ease; white-space: nowrap;';
      document.body.appendChild(t);
    }
    return t;
  }

  function showTip(html, ev) {
    var t = tooltip();
    t.innerHTML = html;
    t.style.opacity = '1';
    t.style.left = (ev.clientX + 14) + 'px';
    t.style.top  = (ev.clientY + 14) + 'px';
  }
  function hideTip() {
    var t = tooltip();
    t.style.opacity = '0';
  }

  // ---- core chart drawing -------------------------------------------
  function drawLine(svg, w, h, data, opts) {
    var margin = { top: 12, right: 16, bottom: 22, left: 44 };
    var iw = w - margin.left - margin.right;
    var ih = h - margin.top - margin.bottom;
    var g = svg.append('g').attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

    // Multi-series support · if first row has .series, render N overlapping lines
    var isMulti = !!(data[0] && data[0].series);
    var seriesKeys = isMulti ? data[0].series.map(function (s) { return s.label; }) : ['value'];
    var seriesColors = isMulti
      ? data[0].series.map(function (s, i) { return s.color || PALETTE_ROTATE[i % PALETTE_ROTATE.length]; })
      : [opts.color || PAL.accent];

    var x = d3.scaleTime()
      .domain(d3.extent(data, function (d) { return parseDate(d.date); }))
      .range([0, iw]);
    var yMax;
    if (isMulti) {
      yMax = d3.max(data, function (d) {
        return d3.max(d.series, function (s) { return s.value; });
      }) || 1;
    } else {
      yMax = d3.max(data, function (d) { return d.value; }) || 1;
    }
    var y = d3.scaleLinear().domain([0, yMax * 1.08]).nice().range([ih, 0]);

    // grid
    g.append('g')
      .attr('class', 'cd-chart-grid')
      .selectAll('line')
      .data(y.ticks(4))
      .enter().append('line')
      .attr('x1', 0).attr('x2', iw)
      .attr('y1', function (d) { return y(d); })
      .attr('y2', function (d) { return y(d); })
      .attr('stroke', PAL.grid).attr('stroke-width', 1);

    // axes
    g.append('g')
      .attr('transform', 'translate(0,' + ih + ')')
      .call(d3.axisBottom(x).ticks(Math.min(5, data.length)).tickFormat(d3.timeFormat('%d %b')).tickSizeOuter(0))
      .call(function (sel) {
        sel.select('.domain').attr('stroke', PAL.grid);
        sel.selectAll('text').attr('fill', PAL.muted).attr('font-size', 10).attr('font-family', 'ui-monospace, monospace');
        sel.selectAll('line').attr('stroke', PAL.grid);
      });
    g.append('g')
      .call(d3.axisLeft(y).ticks(4).tickFormat(fmtTick(opts.yFormat)).tickSizeOuter(0))
      .call(function (sel) {
        sel.select('.domain').remove();
        sel.selectAll('text').attr('fill', PAL.muted).attr('font-size', 10).attr('font-family', 'ui-monospace, monospace');
        sel.selectAll('line').remove();
      });

    // area + line · single OR multi-series
    function drawOneLine(getY, color, isPrimary) {
      var area = d3.area()
        .x(function (d) { return x(parseDate(d.date)); })
        .y0(ih).y1(getY).curve(d3.curveMonotoneX);
      var line = d3.line()
        .x(function (d) { return x(parseDate(d.date)); })
        .y(getY).curve(d3.curveMonotoneX);
      if (isPrimary) {
        g.append('path').datum(data).attr('d', area).attr('fill', color).attr('opacity', 0.10);
      }
      g.append('path').datum(data).attr('d', line).attr('fill', 'none').attr('stroke', color).attr('stroke-width', 1.8);
    }

    if (isMulti) {
      seriesKeys.forEach(function (key, si) {
        drawOneLine(function (d) { return y(d.series[si].value); }, seriesColors[si], si === 0);
        // last-value dot per series
        var last = data[data.length - 1];
        var lv = last && last.series[si] ? last.series[si].value : 0;
        g.append('circle')
          .attr('cx', x(parseDate(last.date))).attr('cy', y(lv))
          .attr('r', 3).attr('fill', seriesColors[si]);
      });
      // legend
      var legend = svg.append('g').attr('transform', 'translate(' + margin.left + ',2)');
      var xOff = 0;
      seriesKeys.forEach(function (k, i) {
        var entry = legend.append('g').attr('transform', 'translate(' + xOff + ',0)');
        entry.append('rect').attr('width', 9).attr('height', 9).attr('fill', seriesColors[i]);
        entry.append('text').attr('x', 13).attr('y', 8).attr('font-family', 'ui-monospace, monospace').attr('font-size', 10).attr('fill', PAL.soft).text(k);
        xOff += (k.length * 6) + 28;
      });
    } else {
      var color = seriesColors[0];
      drawOneLine(function (d) { return y(d.value); }, color, true);
      if (data.length) {
        var last = data[data.length - 1];
        g.append('circle')
          .attr('cx', x(parseDate(last.date))).attr('cy', y(last.value))
          .attr('r', 3).attr('fill', color);
        g.append('text')
          .attr('x', x(parseDate(last.date)) + 6).attr('y', y(last.value) - 6)
          .attr('font-family', 'ui-monospace, monospace').attr('font-size', 10).attr('font-weight', 600).attr('fill', color)
          .text(fmtTick(opts.yFormat)(last.value) + (opts.yLabel ? ' ' + opts.yLabel : ''));
      }
    }

    // hover hit area
    var bisect = d3.bisector(function (d) { return parseDate(d.date); }).left;
    var focus = g.append('g').style('display', 'none');
    focus.append('line').attr('y1', 0).attr('y2', ih).attr('stroke', PAL.muted).attr('stroke-dasharray', '2,2').attr('opacity', 0.5);

    g.append('rect')
      .attr('width', iw).attr('height', ih)
      .attr('fill', 'transparent')
      .on('mousemove', function (ev) {
        var mx = d3.pointer(ev, this)[0];
        var d0 = x.invert(mx);
        var i = bisect(data, d0, 1);
        var a = data[i - 1] || data[0];
        var b = data[i] || a;
        var d = (d0 - parseDate(a.date)) > (parseDate(b.date) - d0) ? b : a;
        focus.style('display', null);
        focus.select('line').attr('transform', 'translate(' + x(parseDate(d.date)) + ',0)');
        var html = '<strong>' + d3.timeFormat('%a %d %b')(parseDate(d.date)) + '</strong>';
        if (isMulti) {
          d.series.forEach(function (s, si) {
            html += '<br><span style="color: ' + seriesColors[si] + ';">●</span> ' +
                    s.label + ': ' + fmtTick(opts.yFormat)(s.value);
          });
        } else {
          html += '<br>' + fmtTick(opts.yFormat)(d.value) + (opts.yLabel ? ' ' + opts.yLabel : '');
        }
        showTip(html, ev);
      })
      .on('mouseleave', function () { focus.style('display', 'none'); hideTip(); });
  }

  function drawBars(svg, w, h, data, opts) {
    // data: [{date, value}] OR [{date, series:[{label,value,color}]}] (stacked)
    var margin = { top: 12, right: 16, bottom: 22, left: 44 };
    var iw = w - margin.left - margin.right;
    var ih = h - margin.top - margin.bottom;
    var g = svg.append('g').attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

    var isStacked = !!(data[0] && data[0].series);
    var keys = isStacked ? data[0].series.map(function (s) { return s.label; }) : ['value'];
    var colors = isStacked
      ? data[0].series.map(function (s, i) { return s.color || PALETTE_ROTATE[i % PALETTE_ROTATE.length]; })
      : [opts.color || PAL.accent];

    var x = d3.scaleBand()
      .domain(data.map(function (d) { return parseDate(d.date).toISOString(); }))
      .range([0, iw]).padding(0.18);
    var yMax;
    if (isStacked) {
      yMax = d3.max(data, function (d) {
        return d.series.reduce(function (acc, e) { return acc + (e.value || 0); }, 0);
      }) || 1;
    } else {
      yMax = d3.max(data, function (d) { return d.value; }) || 1;
    }
    var y = d3.scaleLinear().domain([0, yMax * 1.12]).nice().range([ih, 0]);

    g.append('g')
      .selectAll('line')
      .data(y.ticks(4))
      .enter().append('line')
      .attr('x1', 0).attr('x2', iw)
      .attr('y1', function (d) { return y(d); })
      .attr('y2', function (d) { return y(d); })
      .attr('stroke', PAL.grid).attr('stroke-width', 1);

    // For very dense bars, label only every Nth tick
    var step = Math.max(1, Math.floor(data.length / 6));
    g.append('g')
      .attr('transform', 'translate(0,' + ih + ')')
      .call(d3.axisBottom(x).tickFormat(function (iso, i) {
        if (i % step !== 0) return '';
        return d3.timeFormat('%d %b')(new Date(iso));
      }).tickSizeOuter(0))
      .call(function (sel) {
        sel.select('.domain').attr('stroke', PAL.grid);
        sel.selectAll('text').attr('fill', PAL.muted).attr('font-size', 10).attr('font-family', 'ui-monospace, monospace');
        sel.selectAll('line').attr('stroke', PAL.grid);
      });
    g.append('g')
      .call(d3.axisLeft(y).ticks(4).tickFormat(fmtTick(opts.yFormat)).tickSizeOuter(0))
      .call(function (sel) {
        sel.select('.domain').remove();
        sel.selectAll('text').attr('fill', PAL.muted).attr('font-size', 10).attr('font-family', 'ui-monospace, monospace');
        sel.selectAll('line').remove();
      });

    if (isStacked) {
      var groups = g.selectAll('g.bar-group')
        .data(data).enter().append('g').attr('class', 'bar-group')
        .attr('transform', function (d) { return 'translate(' + x(parseDate(d.date).toISOString()) + ',0)'; });

      groups.each(function (d) {
        var cum = 0;
        var sel = d3.select(this);
        d.series.forEach(function (e, i) {
          var v = e.value || 0;
          var c = e.color || colors[i];
          sel.append('rect')
            .attr('x', 0).attr('width', x.bandwidth())
            .attr('y', y(cum + v)).attr('height', Math.max(0, y(cum) - y(cum + v)))
            .attr('fill', c)
            .on('mousemove', function (ev) {
              showTip(
                '<strong>' + d3.timeFormat('%a %d %b')(parseDate(d.date)) + '</strong><br>' +
                e.label + ': ' + fmtTick(opts.yFormat)(v),
                ev
              );
            })
            .on('mouseleave', hideTip);
          cum += v;
        });
      });
    } else {
      g.selectAll('rect.bar').data(data).enter().append('rect')
        .attr('class', 'bar')
        .attr('x', function (d) { return x(parseDate(d.date).toISOString()); })
        .attr('width', x.bandwidth())
        .attr('y', function (d) { return y(d.value); })
        .attr('height', function (d) { return ih - y(d.value); })
        .attr('fill', colors[0])
        .on('mousemove', function (ev, d) {
          showTip(
            '<strong>' + d3.timeFormat('%a %d %b')(parseDate(d.date)) + '</strong><br>' +
            fmtTick(opts.yFormat)(d.value) + (opts.yLabel ? ' ' + opts.yLabel : ''),
            ev
          );
        })
        .on('mouseleave', hideTip);
    }

    // legend (stacked only)
    if (isStacked && opts.legend !== false) {
      var legend = svg.append('g').attr('transform', 'translate(' + (margin.left) + ',2)');
      var xOff = 0;
      keys.forEach(function (k, i) {
        var entry = legend.append('g').attr('transform', 'translate(' + xOff + ',0)');
        entry.append('rect').attr('width', 9).attr('height', 9).attr('fill', colors[i]);
        entry.append('text').attr('x', 13).attr('y', 8).attr('font-family', 'ui-monospace, monospace').attr('font-size', 10).attr('fill', PAL.soft).text(k);
        xOff += (k.length * 6) + 28;
      });
    }
  }

  function drawDonut(svg, w, h, data, opts) {
    var radius = Math.min(w, h) / 2 - 14;
    var g = svg.append('g').attr('transform', 'translate(' + (w / 2) + ',' + (h / 2) + ')');
    var pie = d3.pie().value(function (d) { return d.value; }).sort(null);
    var arc = d3.arc().innerRadius(radius * 0.58).outerRadius(radius);
    var total = d3.sum(data, function (d) { return d.value; }) || 1;

    g.selectAll('path').data(pie(data)).enter().append('path')
      .attr('d', arc)
      .attr('fill', function (d, i) { return d.data.color || PALETTE_ROTATE[i % PALETTE_ROTATE.length]; })
      .attr('stroke', '#fff').attr('stroke-width', 2)
      .on('mousemove', function (ev, d) {
        var pct = ((d.data.value / total) * 100).toFixed(1);
        showTip('<strong>' + d.data.label + '</strong><br>' + fmtTick(opts.yFormat)(d.data.value) + ' · ' + pct + '%', ev);
      })
      .on('mouseleave', hideTip);

    // centre total
    g.append('text').attr('text-anchor', 'middle').attr('y', -4)
      .attr('font-family', 'ui-monospace, monospace').attr('font-size', 10).attr('fill', PAL.muted)
      .attr('letter-spacing', '0.1em').text('TOTAL');
    g.append('text').attr('text-anchor', 'middle').attr('y', 16)
      .attr('font-family', 'ui-monospace, monospace').attr('font-size', 16).attr('font-weight', 600).attr('fill', PAL.ink)
      .text(fmtTick(opts.yFormat)(total) + (opts.yLabel ? ' ' + opts.yLabel : ''));

    // legend
    var legend = svg.append('g').attr('transform', 'translate(8,8)');
    data.forEach(function (d, i) {
      var entry = legend.append('g').attr('transform', 'translate(0,' + (i * 16) + ')');
      entry.append('rect').attr('width', 9).attr('height', 9).attr('fill', d.color || PALETTE_ROTATE[i % PALETTE_ROTATE.length]);
      entry.append('text').attr('x', 14).attr('y', 8).attr('font-family', 'ui-monospace, monospace').attr('font-size', 10).attr('fill', PAL.soft)
        .text(d.label + ' · ' + fmtTick(opts.yFormat)(d.value));
    });
  }

  function drawFunnel(svg, w, h, data, opts) {
    var margin = { top: 8, right: 90, bottom: 8, left: 130 };
    var iw = w - margin.left - margin.right;
    var ih = h - margin.top - margin.bottom;
    var g = svg.append('g').attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

    var maxV = d3.max(data, function (d) { return d.value; }) || 1;
    var y = d3.scaleBand().domain(data.map(function (d) { return d.label; })).range([0, ih]).padding(0.22);
    var x = d3.scaleLinear().domain([0, maxV]).range([0, iw]);

    g.selectAll('rect.f').data(data).enter().append('rect').attr('class', 'f')
      .attr('x', 0).attr('y', function (d) { return y(d.label); })
      .attr('width', function (d) { return x(d.value); })
      .attr('height', y.bandwidth())
      .attr('fill', opts.color || PAL.accent)
      .attr('opacity', function (d, i) { return 1 - (i * 0.12); });

    g.selectAll('text.f-label').data(data).enter().append('text').attr('class', 'f-label')
      .attr('x', -10).attr('y', function (d) { return y(d.label) + y.bandwidth() / 2 + 3; })
      .attr('text-anchor', 'end').attr('font-family', 'ui-monospace, monospace').attr('font-size', 11).attr('fill', PAL.soft)
      .text(function (d) { return d.label; });

    var first = data[0] ? data[0].value : 0;
    g.selectAll('text.f-val').data(data).enter().append('text').attr('class', 'f-val')
      .attr('x', function (d) { return x(d.value) + 8; })
      .attr('y', function (d) { return y(d.label) + y.bandwidth() / 2 + 3; })
      .attr('font-family', 'ui-monospace, monospace').attr('font-size', 11).attr('font-weight', 600).attr('fill', PAL.ink)
      .text(function (d) {
        var pct = first > 0 ? ((d.value / first) * 100).toFixed(1) : '0.0';
        return fmtTick(opts.yFormat)(d.value) + ' · ' + pct + '%';
      });
  }

  // ---- responsive renderer wrapper ----------------------------------
  function responsive(slotEl, drawFn) {
    function render() {
      var rect = slotEl.getBoundingClientRect();
      var w = Math.max(160, Math.floor(rect.width));
      var h = Math.max(180, Math.floor(rect.height || 220));
      var svg = svgInto(slotEl, w, h);
      drawFn(svg, w, h);
    }
    render();
    if ('ResizeObserver' in window) {
      var ro = new ResizeObserver(render);
      ro.observe(slotEl);
    } else {
      window.addEventListener('resize', render);
    }
  }

  // ---- public API ---------------------------------------------------
  var Api = {};

  Api.dailyLine = function (el, opts) {
    var data = opts.data || [];
    var cum = opts.cumulative !== false;
    var isMulti = !!(data[0] && data[0].series);
    ensureHostStructure(el, cum ? 'pair' : 'single');
    var rateSvg = el.querySelector('[data-slot="rate"] .cd-chart-svg') || el.querySelector('.cd-chart-svg');
    responsive(rateSvg, function (svg, w, h) { drawLine(svg, w, h, data, opts); });
    if (cum) {
      var cumData = isMulti ? stackedCumulative(data) : cumulativeSeries(data);
      var cumSvg = el.querySelector('[data-slot="cum"] .cd-chart-svg');
      responsive(cumSvg, function (svg, w, h) {
        drawLine(svg, w, h, cumData, Object.assign({}, opts, { yLabel: opts.cumulativeYLabel || opts.yLabel }));
      });
    }
  };

  Api.dailyBars = function (el, opts) {
    var data = opts.data || [];
    var cum = opts.cumulative !== false;
    ensureHostStructure(el, cum ? 'pair' : 'single');
    var rateSvg = el.querySelector('[data-slot="rate"] .cd-chart-svg') || el.querySelector('.cd-chart-svg');
    responsive(rateSvg, function (svg, w, h) { drawBars(svg, w, h, data, opts); });
    if (cum) {
      var cumData = data[0] && data[0].series ? stackedCumulative(data) : cumulativeSeries(data);
      var cumSvg = el.querySelector('[data-slot="cum"] .cd-chart-svg');
      // Cumulative of stacked bars is rendered as stacked bars (running total per series).
      // Cumulative of single series is rendered as a line.
      responsive(cumSvg, function (svg, w, h) {
        if (data[0] && data[0].series) {
          drawBars(svg, w, h, cumData, Object.assign({}, opts, { legend: false }));
        } else {
          drawLine(svg, w, h, cumData, Object.assign({}, opts, { yLabel: opts.cumulativeYLabel || opts.yLabel }));
        }
      });
    }
  };

  Api.donut = function (el, opts) {
    ensureHostStructure(el, 'single');
    var slot = el.querySelector('.cd-chart-svg');
    responsive(slot, function (svg, w, h) { drawDonut(svg, w, h, opts.data || [], opts); });
  };

  Api.funnelBars = function (el, opts) {
    ensureHostStructure(el, 'single');
    var slot = el.querySelector('.cd-chart-svg');
    responsive(slot, function (svg, w, h) { drawFunnel(svg, w, h, opts.data || [], opts); });
  };

  // Horizontal categorical bars for snapshot data · same drawing as
  // funnel but without the "% of first" labeling (used for status
  // buckets, histograms, anything where each bar is independent).
  Api.categoricalBars = function (el, opts) {
    ensureHostStructure(el, 'single');
    var slot = el.querySelector('.cd-chart-svg');
    var data = opts.data || [];
    responsive(slot, function (svg, w, h) {
      var margin = { top: 8, right: 70, bottom: 8, left: 150 };
      var iw = w - margin.left - margin.right;
      var ih = h - margin.top - margin.bottom;
      var g = svg.append('g').attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');
      var maxV = d3.max(data, function (d) { return d.value; }) || 1;
      var y = d3.scaleBand().domain(data.map(function (d) { return d.label; })).range([0, ih]).padding(0.22);
      var x = d3.scaleLinear().domain([0, maxV]).range([0, iw]);

      g.selectAll('rect.c').data(data).enter().append('rect').attr('class', 'c')
        .attr('x', 0).attr('y', function (d) { return y(d.label); })
        .attr('width', function (d) { return x(d.value); })
        .attr('height', y.bandwidth())
        .attr('fill', function (d, i) { return d.color || opts.color || PALETTE_ROTATE[i % PALETTE_ROTATE.length]; });

      g.selectAll('text.c-label').data(data).enter().append('text').attr('class', 'c-label')
        .attr('x', -10).attr('y', function (d) { return y(d.label) + y.bandwidth() / 2 + 3; })
        .attr('text-anchor', 'end').attr('font-family', 'ui-monospace, monospace').attr('font-size', 11).attr('fill', PAL.soft)
        .text(function (d) { return d.label; });

      g.selectAll('text.c-val').data(data).enter().append('text').attr('class', 'c-val')
        .attr('x', function (d) { return x(d.value) + 8; })
        .attr('y', function (d) { return y(d.label) + y.bandwidth() / 2 + 3; })
        .attr('font-family', 'ui-monospace, monospace').attr('font-size', 11).attr('font-weight', 600).attr('fill', PAL.ink)
        .text(function (d) { return fmtTick(opts.yFormat)(d.value); });
    });
  };

  window.CdChart = Api;
})();
