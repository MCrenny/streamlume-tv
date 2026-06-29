@echo off
call npm install --save-dev @babel/plugin-transform-optional-catch-binding@^7 @babel/plugin-transform-object-rest-spread@^7
call npx expo export -p web -c
node fix_import_meta.js
git add .
git commit -m "fix(web): fix stale closure in PlayerScreen preventing controls from waking up on keypress"
git push
