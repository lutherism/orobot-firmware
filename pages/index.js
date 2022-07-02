const React = require('react');
const Component = React.Component;

const API_BASE = location.host === 'localhost:3006' ?
  'http://192.168.4.1' : ''

function ListWifi({
  networks,
  onSelect
}) {
  if (!networks) {
    return (
      <span>{'No Networks Found'}</span>
    );
  }
  return networks.map(n => {
    return (
      <div onClick={() => onSelect(n.ssid)}>
        {n.ssid}
      </div>
    );
  })
}

const lineDelineator = '\n                    ';

function parseWifiScanOutput(output) {
  const uniqueTable = {};
  const parsed = output
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
          a['password'] = line.slice(15);
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
      return <div />;
    }
    return (
      <form onSubmit={e => {
        e.preventDefault();
        fetch(API_BASE + '/api/wifi', {
          method: 'post',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ssid: this.props.connection,
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
        <h3>{`Signin for ${this.props.connection}`}</h3>
        <input value={this.state.password}
          onChange={e => {
            this.setState({
              password: e.target.value
            });
          }} type="text" />
        <button type="submit">submit</button>
        <button onClick={this.props.clear}>clear</button>
        <div>{this.state.result}</div>
      </form>
    );
  }
}

class Home extends Component {
  constructor() {
    super();
    this.state = {};
  }

  componentDidMount() {
    if (!this.state.networks) {
      fetch(API_BASE + '/api/wifi')
        .then(r => r.json())
        .then((res) => {
          this.setState({
            networks: parseWifiScanOutput(res.wifi)
          });
        });
    }
  }
  render() {
    return (
      <div>
        <main>
          <img src="/LOGO-Open-Robotics-transparent-SMALL.png"
            style={{width: '150px'}}/>
          <h1>
            Wifi Setup
          </h1>
          <button onClick={() => {
            fetch(API_BASE + '/api/goto-client', {
              method: 'POST'
            });
          }}>
            {'client mode'}
          </button>
          <ConnectionForm connection={this.state.connection}
            clear={() => this.setState({connection: null})}/>
          {!this.state.connection ?
            <ListWifi
              networks={this.state.networks}
              onSelect={ssid => this.setState({connection: ssid})} /> : null}
        </main>
      </div>
    )
  }
}

module.exports = Home;
