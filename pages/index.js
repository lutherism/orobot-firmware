const React = require('react');
const Component = React.Component;

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
    const [password, setPassword] = useState('');
    const [result, setResult] = useState('');
    return (
      <form onSubmit={e => {
        e.preventDefault();
        fetch('/api/wifi', {
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
        <button>submit</button>
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
      fetch('/api/wifi')
        .then((res) => {
          this.setState({
            networks: Object.values(res.networks.reduce((a, n) => {
              a[n.ssid] = n;
              return a;
            }, {}))
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
          <ConnectionForm connection={this.state.connection} />
          <ListWifi networks={this.state.networks} onSelect={() => {}} />
        </main>
      </div>
    )
  }
}

module.exports = Home;
