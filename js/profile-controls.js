// Styled profile controls retain the native fields for address dependencies and saving.
(function () {
  'use strict';
  var D = window.DS;
  D.ui.profileControls = function (root) {
    if (!HTMLElement.prototype.showPopover) return {refresh:function () {}};
    var controls = new Map(), serial = 0;
    var icon = function (name) { return '<span class="material-symbols-outlined" aria-hidden="true">' + name + '</span>'; };
    function label(field) {
      var element = field.labels && field.labels[0];
      return element ? (element.querySelector('span') || element).textContent.trim() : field.id;
    }
    function host(field, kind, symbol) {
      var trigger = document.createElement('button'), panel = document.createElement('div');
      trigger.type = 'button'; trigger.className = 'profile-field-trigger';
      trigger.id = field.id + '-control';
      trigger.setAttribute('aria-label', label(field));
      trigger.setAttribute('aria-haspopup', kind === 'select' ? 'listbox' : 'dialog');
      trigger.setAttribute('aria-expanded', 'false');
      panel.id = 'profile-picker-' + (++serial);
      panel.className = 'profile-control-picker ' + (kind === 'select' ? 'city-options profile-select-menu' : 'datetime-picker profile-birthday-menu');
      panel.setAttribute('popover', 'auto'); panel.setAttribute('role', kind === 'select' ? 'listbox' : 'dialog');
      panel.setAttribute('aria-label', label(field)); panel.tabIndex = -1;
      trigger.setAttribute('aria-controls', panel.id);
      field.hidden = true; field.after(trigger, panel);
      field.parentElement.querySelectorAll(':scope > span.absolute').forEach(function (el) { el.hidden = true; el.style.display = 'none'; });
      function position() {
        var rect = trigger.getBoundingClientRect();
        panel.style.width = Math.min(kind === 'select' ? rect.width : 312, innerWidth - 24) + 'px';
        panel.style.maxHeight = (kind === 'select' ? 320 : innerHeight - 24) + 'px';
        var gap = 6, edge = 12;
        var below = Math.max(0, innerHeight - rect.bottom - gap - edge);
        var above = Math.max(0, rect.top - gap - edge);
        var desired = Math.min(panel.scrollHeight + 2, kind === 'select' ? 320 : innerHeight - edge * 2);
        var opensBelow = below >= Math.min(desired, 180) || below >= above;
        panel.style.maxHeight = Math.min(desired, opensBelow ? below : above) + 'px';
        var height = panel.offsetHeight;
        panel.style.left = Math.max(edge, Math.min(rect.left, innerWidth - panel.offsetWidth - edge)) + 'px';
        panel.style.top = (opensBelow ? rect.bottom + gap : Math.max(edge, rect.top - gap - height)) + 'px';
      }
      panel.addEventListener('toggle', function (event) { trigger.setAttribute('aria-expanded', String(event.newState === 'open')); });
      panel.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') { event.preventDefault(); panel.hidePopover(); trigger.focus(); }
      });
      return {
        trigger:trigger, panel:panel, position:position,
        paint:function (text, disabled) {
          trigger.innerHTML = icon(symbol) + '<span class="profile-field-value">' + D.esc(text) + '</span>' + icon(kind === 'select' ? 'expand_more' : 'calendar_month');
          trigger.disabled = !!disabled;
        },
        close:function () { panel.hidePopover(); trigger.focus(); }
      };
    }
    function select(field) {
      var symbols = {'mp-civil':'person','ph-prov':'map','ph-city':'location_city','ph-brgy':'holiday_village'};
      var ui = host(field, 'select', symbols[field.id] || 'location_on');
      function sync() {
        var chosen = field.options[field.selectedIndex];
        ui.paint(chosen ? chosen.textContent : 'Choose an option', field.disabled);
        if (field.disabled && ui.panel.matches(':popover-open')) ui.panel.hidePopover();
      }
      function draw() {
        ui.panel.innerHTML = Array.from(field.options).map(function (option, index) {
          return '<button type="button" role="option" data-option="' + index + '" aria-selected="' + option.selected + '" tabindex="-1"' + (option.disabled ? ' disabled' : '') + '><span>' + D.esc(option.textContent) + '</span>' + (option.selected ? icon('check') : '') + '</button>';
        }).join('');
      }
      ui.trigger.onclick = function () {
        if (ui.panel.matches(':popover-open')) return ui.close();
        draw(); ui.panel.showPopover(); ui.position();
        var selected = ui.panel.querySelector('[aria-selected="true"]:not(:disabled)') || ui.panel.querySelector('button:not(:disabled)');
        if (selected) { selected.focus({preventScroll:true}); ui.panel.scrollTop = Math.max(0, selected.offsetTop - ui.panel.clientHeight / 2); }
      };
      ui.panel.onclick = function (event) {
        var button = event.target.closest('[data-option]');
        if (!button || button.disabled) return;
        event.preventDefault();
        field.selectedIndex = Number(button.dataset.option);
        field.dispatchEvent(new Event('change', {bubbles:true})); sync(); ui.close();
      };
      ui.trigger.addEventListener('keydown', function (event) {
        if (['ArrowDown','ArrowUp','Home','End'].includes(event.key)) { event.preventDefault(); ui.trigger.click(); }
      });
      var typed = '', lastTyped = 0;
      ui.panel.addEventListener('keydown', function (event) {
        var options = Array.from(ui.panel.querySelectorAll('[role="option"]:not(:disabled)'));
        var index = options.indexOf(document.activeElement), target;
        if (event.key === 'ArrowDown') target = options[(index + 1) % options.length];
        if (event.key === 'ArrowUp') target = options[(index - 1 + options.length) % options.length];
        if (event.key === 'Home') target = options[0];
        if (event.key === 'End') target = options[options.length - 1];
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && event.key !== ' ') {
          typed = (Date.now() - lastTyped > 700 ? '' : typed) + event.key.toLowerCase(); lastTyped = Date.now();
          target = options.find(function (option) { return option.textContent.trim().toLowerCase().startsWith(typed); });
        }
        if (target) { event.preventDefault(); target.focus({preventScroll:true}); var top = target.offsetTop; if (top < ui.panel.scrollTop) ui.panel.scrollTop = top; else if (top + target.offsetHeight > ui.panel.scrollTop + ui.panel.clientHeight) ui.panel.scrollTop = top + target.offsetHeight - ui.panel.clientHeight; }
      });
      field.addEventListener('change', sync); sync();
      return {refresh:sync};
    }
    function birthday(field) {
      var ui = host(field, 'birthday', 'cake');
      var now = new Date(), today = localDate(now), year, month, view = 'days';
      var monthNames = Array.from({length:12}, function (_, i) { return new Date(2000,i,1).toLocaleString('en-US',{month:'short'}); });
      function localDate(date) { return date.getFullYear() + '-' + String(date.getMonth()+1).padStart(2,'0') + '-' + String(date.getDate()).padStart(2,'0'); }
      function allowed(value) { return (!field.min || value >= field.min) && value <= today; }
      function sync() { ui.paint(field.value ? new Date(field.value + 'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : 'Select date of birth', field.disabled); }
      function draw() {
        var title = view === 'days' ? monthNames[month] + ' ' + year : view === 'months' ? String(year) : (year - 11) + ' – ' + year;
        var html = '<div class="profile-calendar-heading"><button type="button" data-nav="-1" aria-label="Previous ' + (view === 'years' ? '12 years' : view === 'months' ? 'year' : 'month') + '">' + icon('chevron_left') + '</button><button type="button" data-view aria-label="Choose month and year">' + title + icon('expand_more') + '</button><button type="button" data-nav="1" aria-label="Next ' + (view === 'years' ? '12 years' : view === 'months' ? 'year' : 'month') + '">' + icon('chevron_right') + '</button></div>';
        if (view === 'years') {
          html += '<div class="profile-calendar-choices">';
          for (var y = year - 11; y <= year; y++) html += '<button type="button" data-year="' + y + '"' + (y < 1900 || y > now.getFullYear() ? ' disabled' : '') + '>' + y + '</button>';
          html += '</div>';
        } else if (view === 'months') {
          html += '<div class="profile-calendar-choices">' + monthNames.map(function (name,i) { return '<button type="button" data-calendar-month="' + i + '"' + (year === now.getFullYear() && i > now.getMonth() ? ' disabled' : '') + '>' + name + '</button>'; }).join('') + '</div>';
        } else {
          html += '<div class="datetime-week" aria-hidden="true">' + ['Su','Mo','Tu','We','Th','Fr','Sa'].map(function (name) { return '<span>' + name + '</span>'; }).join('') + '</div><div class="datetime-days">';
          for (var offset=0; offset < new Date(year,month,1).getDay(); offset++) html += '<span></span>';
          for (var d=1; d<=new Date(year,month+1,0).getDate(); d++) {
            var value=localDate(new Date(year,month,d));
            html += '<button type="button" data-birthday="' + value + '" aria-label="' + value + '" aria-pressed="' + (value === field.value) + '"' + (value === today ? ' aria-current="date"' : '') + (!allowed(value) ? ' disabled' : '') + '>' + d + '</button>';
          }
          html += '</div>';
        }
        ui.panel.innerHTML = html + '<div class="datetime-actions"><button type="button" data-clear>Clear</button><button type="button" data-today>Today</button></div>';
      }
      ui.trigger.onclick = function () {
        if (ui.panel.matches(':popover-open')) return ui.close();
        var selected = new Date((field.value || today) + 'T12:00:00');
        year=selected.getFullYear(); month=selected.getMonth(); view='days';
        draw(); ui.panel.showPopover(); ui.position();
        (ui.panel.querySelector('[aria-pressed="true"]') || ui.panel.querySelector('[data-view]')).focus();
      };
      ui.panel.onclick = function (event) {
        var button=event.target.closest('button'); if (!button || button.disabled) return;
        event.preventDefault();
        if (button.hasAttribute('data-birthday') || button.hasAttribute('data-clear')) {
          field.value=button.dataset.birthday || ''; field.dispatchEvent(new Event('change',{bubbles:true})); sync(); ui.close(); return;
        }
        if (button.hasAttribute('data-view')) { view=view === 'days' ? 'years' : view === 'years' ? 'months' : 'years'; }
        else if (button.hasAttribute('data-nav')) {
          var delta=Number(button.dataset.nav);
          if (view === 'days') { var date=new Date(year,month+delta,1); year=date.getFullYear(); month=date.getMonth(); }
          else year += delta * (view === 'years' ? 12 : 1);
          year=Math.max(1900,Math.min(now.getFullYear(),year));
        } else if (button.hasAttribute('data-year')) { year=Number(button.dataset.year); view='months'; }
        else if (button.hasAttribute('data-calendar-month')) { month=Number(button.dataset.calendarMonth); view='days'; }
        else if (button.hasAttribute('data-today')) { year=now.getFullYear(); month=now.getMonth(); view='days'; }
        draw(); ui.position(); (ui.panel.querySelector('[data-view]')).focus();
      };
      ui.panel.addEventListener('keydown', function (event) {
        if (!event.target.dataset.birthday) return;
        var offsets={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7};
        if (!offsets[event.key]) return;
        event.preventDefault(); var next=new Date(event.target.dataset.birthday+'T12:00:00'); next.setDate(next.getDate()+offsets[event.key]);
        var value=localDate(next); if (!allowed(value)) return;
        year=next.getFullYear(); month=next.getMonth(); draw(); ui.panel.querySelector('[data-birthday="'+value+'"]').focus();
      });
      field.addEventListener('change',sync); sync(); return {refresh:sync};
    }
    function refresh() {
      root.querySelectorAll('select').forEach(function (field) {
        if (!controls.has(field)) controls.set(field,select(field));
        else controls.get(field).refresh();
      });
      var birth=root.querySelector('#mp-birth');
      if (birth && !controls.has(birth)) controls.set(birth,birthday(birth));
      else if (birth) controls.get(birth).refresh();
    }
    var observer=new MutationObserver(function (records) {
      if (records.some(function (record) {
        return record.target.tagName === 'SELECT' || (record.target.closest && record.target.closest('select')) || Array.from(record.addedNodes || []).some(function (node) {return node.nodeType === 1 && (node.tagName === 'SELECT' || node.querySelector('select'));});
      })) refresh();
    });
    observer.observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled']});
    refresh(); return {refresh:refresh, destroy:function () {observer.disconnect();}};
  };
})();
