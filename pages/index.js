const React = require('react');
const Component = React.Component;
const {Input} = require('baseui/input');
const {Button, KIND} = require('baseui/button');
const { Spinner } = require("baseui/spinner");
const API_BASE = false ? 'http://192.168.4.1' : '';

function ListWifi({
  networks,
  loading,
  onSelect
}) {
  if (loading) {
    return <Spinner />;
  }
  if (!networks) {
    return (
      <span>{'No Networks Found'}</span>
    );
  }
  return networks.map(n => {
    return (
      <div style={{
        marginBottom: '12px'
      }}>
        <Button
          kind={KIND.secondary}
          onClick={() => onSelect(n)}>
          {n.ssid}
        </Button>
      </div>
    );
  })
}

const lineDelineator = '\n                    ';

function parseWifiScanOutput(output) {
  if (output.macWifi) {
    const uniqueTable = {};
    const parsed = output.macWifi
      .slice(1)
      .map(node => {
        const cols = new RegExp("\\s*([a-zA-Z0-9-_\\s]*)\\s*([a-fA-F0-9]{2}:[a-fA-F0-9]{2}:[a-fA-F0-9]{2}:[a-fA-F0-9]{2}:[a-fA-F0-9]{2}:[a-fA-F0-9]{2})\\s*([-|+]{1}[0-9]*)\\s*([0-9]*,*[-|+]*[0-9]*)\\s*([Y|N]{1})\\s*([A-Z-]*)\\s*(.*)")
          .exec(node.trim());
        console.log(cols);
        if (!cols) {
          return null;
        }
        return {
          ssid: cols[1],
          mac: cols[2],
          security: cols[7]
        }
      })
      .filter(x => {
        if (!x) {
          return null;
        }
        if (uniqueTable[x.ssid]) {
          return false;
        }
        uniqueTable[x.ssid] = true;
        return x.ssid.length > 0
      });
    return parsed;
  }
  const uniqueTable = {};
  const parsed = output.wifi
    .slice(1)
    .map(node => {
      return node.split(lineDelineator).reduce((a, line) => {
        if (line.indexOf('ESSID') === 0) {
          a['ssid'] = line.slice(7, -1);
        }
        if (line.indexOf('Address:') > -1) {
          a['mac'] = line.slice(15);
        }
        if (line.indexOf('Encryption key') === 0) {
          a['security'] = line.slice(15);
        }
        return a;
      }, {});
    })
    .filter(x => {
      if (uniqueTable[x.ssid]) {
        return false;
      }
      uniqueTable[x.ssid] = true;
      return x.ssid.length > 0
    });
  return parsed;
}

class ConnectionForm extends Component {
  constructor(props) {
    super(props);
    this.state = {};
  }

  componentDidMount() {
  }
  render() {
    if (!this.props.connection) {
      return null;
    }
    if (this.props.connection &&
        this.props.connection.security.indexOf('WPA2') > -1) {
      return (
        <form onSubmit={e => {
          e.preventDefault();
          fetch(API_BASE + '/api/wifi', {
            method: 'post',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              ssid: this.props.connection.ssid,
              username: this.state.username,
              password: this.state.password
            })
          })
          .then(r => r.json())
          .then(r => {
            this.setState({
              result: r.msg
            })
          });
        }}>
          <h3>{`Signin for ${this.props.connection.ssid}`}</h3>
          <Input value={this.state.username}
            onChange={e => {
              this.setState({
                username: e.target.value
              });
            }} type="text" />
          <Input value={this.state.password}
            onChange={e => {
              this.setState({
                password: e.target.value
              });
            }} type="text" />
          <Button type="submit">submit</Button>
          <Button onClick={this.props.clear}>clear</Button>
          <div>{this.state.result}</div>
        </form>);
    }
    if (this.props.connection)
    return (
      <form onSubmit={e => {
        e.preventDefault();
        fetch(API_BASE + '/api/wifi', {
          method: 'post',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ssid: this.props.connection.ssid,
            password: this.state.password
          })
        })
        .then(r => r.json())
        .then(r => {
          this.setState({
            result: r.msg
          })
        });
      }}>
        <h3>{`Signin for ${this.props.connection.ssid}`}</h3>
        <div style={{
          marginBottom: '12px'
        }}>
          <Input value={this.state.password}
            onChange={e => {
              this.setState({
                password: e.target.value
              });
            }} type="text" />
        </div>
        <div style={{
          marginBottom: '12px'
        }}>
          <Button type="submit">submit</Button>
        </div>
        <div style={{
          marginBottom: '12px'
        }}>
          <Button onClick={this.props.clear}>clear</Button>
        </div>
        <div style={{
          marginBottom: '12px'
        }}>
          <div>{this.state.result}</div>
        </div>
      </form>
    );
  }
}

class Home extends Component {
  constructor() {
    super();
    this.state = {
      loading: true
    };
  }

  componentDidMount() {
    if (!this.state.networks) {
      fetch(API_BASE + '/api/wifi')
        .then(r => r.json())
        .then((res) => {
          this.setState({
            networks: parseWifiScanOutput(res),
            loading: false
          });
        });
    }
  }
  render() {
    return (
      <div>
        <main>
          <img src="/logo2.png"
            style={{width: '150px'}}/>
          <h1>
            Wifi Setup
          </h1>
          <div style={{
            marginBottom: '12px'
          }}>
            <Button onClick={() => {
              fetch(API_BASE + '/api/goto-client', {
                method: 'POST'
              });
            }}>
              {'client mode'}
            </Button>
          </div>
          <ConnectionForm connection={this.state.connection}
            clear={() => this.setState({connection: null})}/>
          {!this.state.connection ?
            <ListWifi
              loading={this.state.loading}
              networks={this.state.networks}
              onSelect={network => this.setState({connection: network})} /> : null}
        </main>
      </div>
    )
  }
}

module.exports = Home;
