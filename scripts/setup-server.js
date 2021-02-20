var App = require('koa');
var koaStatic = require('koa-static');

var app = new App();

app.use(koaStatic('./public'));

app.listen(1337);
