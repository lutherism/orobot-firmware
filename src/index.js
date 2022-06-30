var App = require('../pages/index.js');
var ReactDOM = require('react-dom');
var React = require('react');

document.addEventListener('DOMContentLoaded', (event) => {
  ReactDOM.render(<App />, document.querySelector('#app'));
});
