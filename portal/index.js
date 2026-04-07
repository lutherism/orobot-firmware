var App = require('../pages/index.js');
var ReactDOM = require('react-dom');
var React = require('react');
const {Client: Styletron} = require('styletron-engine-monolithic');
const {Provider: StyletronProvider} = require('styletron-react');
const {LightTheme, BaseProvider, styled} = require('baseui');

const engine = new Styletron();

document.addEventListener('DOMContentLoaded', (event) => {
  ReactDOM.render(
    <StyletronProvider value={engine}>
      <BaseProvider theme={LightTheme}>
        <App />
      </BaseProvider>
    </StyletronProvider>, document.querySelector('#app'));
});
