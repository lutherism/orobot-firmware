import Head from 'next/head'
import styles from '../styles/Home.module.css'
import {useState, useEffect} from 'react';

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

function ConnectionForm({
  connection
}) {
  if (!connection) {
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
          ssid: connection,
          password
        })
      })
      .then(r => r.json())
      .then(r => {
        setResult(r.msg)
      });
    }}>
      <h3>{`Signin for ${connection}`}</h3>
      <input value={password}
        onChange={e => {
          setPassword(e.target.value);
        }} type="text" />
      <button>submit</button>
      <div>{result}</div>
    </form>
  );
}

export default function Home() {

  const [networks, setNetworks] = useState(null);
  const [connection, setConnection] = useState('');

  useEffect(() => {
    if (!networks) {
      fetch('/api/wifi')
        .then(r => r.json())
        .then((res) => {
          setNetworks(Object.values(res.networks.reduce((a, n) => {
            a[n.ssid] = n;
            return a;
          }, {})));
        });
    }
  })
  return (
    <div className={styles.container}>
      <Head>
        <title>Create Next App</title>
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <main className={styles.main}>
        <img src="/LOGO-Open-Robotics-transparent-SMALL.png"
          style={{width: '150px'}}/>
        <h1 className={styles.title}>
          Wifi Setup
        </h1>
        <ConnectionForm connection={connection} />
        <ListWifi networks={networks} onSelect={setConnection} />
      </main>
    </div>
  )
}
