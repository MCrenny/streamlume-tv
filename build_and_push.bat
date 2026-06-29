@echo off
call npm install --save-dev @babel/plugin-transform-optional-catch-binding@^7 @babel/plugin-transform-object-rest-spread@^7
call npx expo export -p web -c
node fix_import_meta.js
git add .
git commit -m "fix(web): force exact pixel height for small player and 100% dimensions on video wrapper to fix invisible video on old Tizen"
git push
