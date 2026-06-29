@echo off
call npm install --save-dev @babel/plugin-transform-optional-catch-binding@^7 @babel/plugin-transform-object-rest-spread@^7
call npx expo export -p web -c
node fix_import_meta.js
git add .
git commit -m "fix(web): add DOM polyfills (ResizeObserver, IntersectionObserver) for older smart TVs"
git push
