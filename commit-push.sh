node node_modules/browserify/bin/cmd.js -t [ babelify --presets [ react ] ] ./src/index.js -o ./public/index.js
npm run test && git add . && git commit . -m 'work' && git push
