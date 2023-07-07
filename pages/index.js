const React = require('react');
const Component = React.Component;
const {Input} = require('baseui/input');
const {Button, KIND} = require('baseui/button');
const { Spinner } = require("baseui/spinner");
const API_BASE = false ? 'http://192.168.4.1' : '';
const parseWifiScanOutput = require('../scripts/parseWifiScanOutput.js');
function ListWifi({
  uniqueNetworks,
  rawNetworks,
  knownNetworks,
  loading,
  onKnownSelect,
  onSelect
}) {
  if (loading) {
    return <Spinner />;
  }
  if (!uniqueNetworks) {
    return (
      <span>{'No Networks Found'}</span>
    );
  }
  return (
    <div>
      {knownNetworks.length &&
        rawNetworks.length ?
        <div>
          <h5>{'Known Networks'}</h5>
          {knownNetworks.filter(x => {
            return rawNetworks.filter(y => {
              return y && x && y.mac === x.mac
            })[0];
          }).map(n => {
            return (
              <span style={{
                margin: '0 12px 12px 0',
                display: 'inline-block'
              }}>
                <Button
                  kind={KIND.secondary}
                  onClick={() => onKnownSelect(n)}>
                  {n.ssid}
                </Button>
              </span>
            );
          })}
        </div> : null}
      <h5>{'Scanned Networks'}</h5>
      {uniqueNetworks.map(n => {
        return (
          <span style={{
            margin: '0 12px 12px 0',
            display: 'inline-block'
          }}>
            <Button
              kind={KIND.secondary}
              onClick={() => onSelect(n)}>
              {n.ssid}
            </Button>
          </span>
        );
      })}
    </div>
  );
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
      return <span />;
    }
    if (this.props.connection &&
        this.props.connection.security.indexOf('802.1x') > -1) {
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
              mac: this.props.connection.mac,
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
}

class Home extends Component {
  constructor() {
    super();
    this.state = {
      loading: true
    };
  }

  componentDidMount() {
    if (!this.state.rawNetworks) {
      fetch(API_BASE + '/api/wifi')
        .then(r => r.json())
        .then((res) => {
          const {
            uniqueNetworks,
            rawNetworks
          } = parseWifiScanOutput(res)
          this.setState({
            uniqueNetworks,
            rawNetworks,
            loading: false
          });
        });
    }
    if (!this.state.knownNetworks) {
      fetch(API_BASE + '/api/known-wifi')
        .then(r => r.json())
        .then((res) => {
          this.setState({
            knownNetworks: res.knownNetworks
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
          <ConnectionForm connection={this.state.connection}
            clear={() => this.setState({connection: null})}/>
          {!this.state.connection ?
            <ListWifi
              loading={this.state.loading}
              knownNetworks={this.state.knownNetworks}
              rawNetworks={this.state.rawNetworks}
              uniqueNetworks={this.state.uniqueNetworks}
              onKnownSelect={n => {
                fetch(API_BASE + '/api/wifi', {
                  method: 'post',
                  headers: {
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    ssid: n.ssid,
                    mac: n.mac,
                    password: n.password
                  })
                })
                .then(r => r.json())
                .then(r => {
                  this.setState({
                    result: r.msg
                  })
                });
              }}
              onSelect={network => {
                if (network.security.indexOf('NONE') > -1) {
                  fetch(API_BASE + '/api/wifi', {
                    method: 'post',
                    headers: {
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                      ssid: network.ssid,
                      mac: network.mac,
                      password: network.psk
                    })
                  })
                  .then(r => r.json())
                  .then(r => {
                    this.setState({
                      result: r.msg
                    })
                  });
                }
                this.setState({connection: network});
              }} /> : null}
        </main>
      </div>
    )
  }
}

module.exports = Home;
