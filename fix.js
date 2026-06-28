const fs = require('fs');
const path = require('path');

function processDir(dir) {
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir);

  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);

    if (fs.statSync(fullPath).isDirectory()) {
      if (fullPath.includes('node_modules')) continue;
      processDir(fullPath);
    } else if (fullPath.endsWith('.js')) {
      if (file === 'fix.js' || file === 'server.js') continue;
      let content = fs.readFileSync(fullPath, 'utf8');
      if (content.includes('import.meta')) {
        console.log(`Fixing import.meta in ${fullPath}`);
        content = content.replace(/import\.meta\.env/g, '({MODE:"production"})');
        content = content.replace(/import\.meta/g, '({env:{MODE:"production"},url:window.location.href})');
        fs.writeFileSync(fullPath, content, 'utf8');
      }
      if (content.includes('aspectRatio:')) {
        console.log(`Patching aspectRatio and tile widths in ${fullPath}`);
        content = content.replace(/width:'13%'/g, "width:'17.5%'");
        content = content.replace(/width:'9%'/g, "width:'12%'");
        content = content.replace(/width:'24%'/g, "width:'30%'");
        content = content.replace(/aspectRatio:1\.35\b/g, "aspectRatio:1.35,height:'11vw'");
        content = content.replace(/aspectRatio:1\.4\b/g, "aspectRatio:1.4,height:'8vw'");
        content = content.replace(/aspectRatio:1\.3\b/g, "aspectRatio:1.3,height:'20vw'");
        fs.writeFileSync(fullPath, content, 'utf8');
      }
    } else if (file === 'index.html') {
      let content = fs.readFileSync(fullPath, 'utf8');
      if (!content.includes('globalThis =')) {
        console.log(`Injecting extra polyfills into ${fullPath}`);
        const polyfills = `
    <script>
      // Polyfill for TVXPlugin to fix navigate crash
      window.addEventListener('load', function() {
        if (typeof tvx !== 'undefined' && tvx.plugin) {
          try { tvx.plugin.init(); } catch(e) {}
          window.TVXPlugin = tvx.plugin;
        } else {
          window.TVXPlugin = {
            executeAction: function(action) {
              console.log('TVXPlugin Mock executeAction:', action);
              if (action.startsWith('video:')) {
                // If it's a video action, just redirect as fallback
                window.location.href = action.replace('video:', '');
              }
            }
          };
        }
      });
    </script>
    <script>
      if (typeof globalThis === 'undefined') {
        Object.defineProperty(Object.prototype, '__magic__', {
            get: function() { return this; },
            configurable: true
        });
        __magic__.globalThis = __magic__;
        delete Object.prototype.__magic__;
      }
      if (typeof queueMicrotask === 'undefined') {
        window.queueMicrotask = function(callback) {
          Promise.resolve().then(callback).catch(function(e){setTimeout(function(){throw e;})});
        };
      }
    </script>
    <script>
      (function() {
        var wakeLock = null;
        function keepAwake() {
          if ('wakeLock' in navigator) {
            navigator.wakeLock.request('screen').then(function(wl) { wakeLock = wl; }).catch(function() {});
          }
          if (typeof tvx !== 'undefined' && tvx.plugin && typeof tvx.plugin.executeAction === 'function') {
            tvx.plugin.executeAction('awake');
          }
          if (typeof tizen !== 'undefined' && tizen.power && typeof tizen.power.request === 'function') {
            try { tizen.power.request("SCREEN", "SCREEN_NORMAL"); } catch(e) {}
          }
        }
        setInterval(keepAwake, 30000);
        setTimeout(keepAwake, 2000);
      })();
    </script>
    <script>
      (function() {
        var currentFocus = null;
        function getFocusableElements() {
          var els = Array.from(document.querySelectorAll('[tabindex="0"], a, button, input, [role="button"], [role="link"]'));
          return els.filter(function(el) {
            var rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && window.getComputedStyle(el).visibility !== 'hidden';
          });
        }
        function setFocus(el) {
          if (currentFocus) {
            currentFocus.classList.remove('tv-focus');
            currentFocus.blur();
          }
          currentFocus = el;
          if (currentFocus) {
            currentFocus.classList.add('tv-focus');
            currentFocus.focus();
            currentFocus.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
          }
        }
        window.addEventListener('load', function() {
          var style = document.createElement('style');
          style.innerHTML = '.tv-focus { outline: 4px solid #00f0ff !important; box-shadow: 0 0 15px #00f0ff !important; border-radius: 8px; z-index: 9999; position: relative; }';
          document.head.appendChild(style);
          setTimeout(function() {
            var els = getFocusableElements();
            if (els.length > 0) setFocus(els[0]);
          }, 1500);
        });
        window.addEventListener('keydown', function(e) {
          var keyCode = e.keyCode;
          if ([37, 38, 39, 40, 13].indexOf(keyCode) !== -1) {
            if (keyCode === 13) {
              if (currentFocus) {
                if (currentFocus.tagName === 'INPUT' || currentFocus.tagName === 'TEXTAREA') return;
                e.stopPropagation(); e.preventDefault();
                ['pointerdown', 'mousedown', 'touchstart', 'pointerup', 'mouseup', 'touchend', 'click'].forEach(function(type) {
                  currentFocus.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
                });
              }
              return;
            }
            e.stopPropagation(); e.preventDefault();
            var els = getFocusableElements();
            if (els.length === 0) return;
            if (!currentFocus || els.indexOf(currentFocus) === -1) { setFocus(els[0]); return; }
            var rect1 = currentFocus.getBoundingClientRect();
            var cx1 = rect1.left + rect1.width / 2, cy1 = rect1.top + rect1.height / 2;
            var bestNode = null, bestDist = Infinity;
            els.forEach(function(el) {
              if (el === currentFocus) return;
              var rect2 = el.getBoundingClientRect(), cx2 = rect2.left + rect2.width / 2, cy2 = rect2.top + rect2.height / 2;
              var dx = cx2 - cx1, dy = cy2 - cy1;
              if ((keyCode === 39 && dx > 0 && Math.abs(dx) > Math.abs(dy)) ||
                  (keyCode === 37 && dx < 0 && Math.abs(dx) > Math.abs(dy)) ||
                  (keyCode === 40 && dy > 0 && Math.abs(dy) > Math.abs(dx)) ||
                  (keyCode === 38 && dy < 0 && Math.abs(dy) > Math.abs(dx))) {
                var dist = Math.sqrt(dx*dx + dy*dy);
                if (dist < bestDist) { bestDist = dist; bestNode = el; }
              }
            });
            if (bestNode) setFocus(bestNode);
          }
        }, true);
      })();
    </script>`;
        content = content.replace(/<script src="https:\/\/unpkg.com\/resize-observer-polyfill[^>]+><\/script>/g, ''); // Clean up old duplicate if any
        content = content.replace('<head>', '<head>' + polyfills);
        fs.writeFileSync(fullPath, content, 'utf8');
      }
    }
  }
}

processDir(path.join(__dirname));
console.log('Done fixing JS bundles and injecting polyfills.');
