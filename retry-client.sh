BASEDIR="/home/pi/orobot-firmware"

if ps ax | grep -v grep | grep "retry-client.sh" > /dev/null
then
  echo "Duplicate process"
  exit 0;
fi

echo "sudo $BASEDIR/switch-to-wifi-client.sh" | bash
sleep 45s
while [ "$(curl google.com | grep 301)" = "" ]; do
  echo "No network: $(date)"
  if ps ax | grep -v grep | grep "switch-to-wifi-client.sh" > /dev/null
  then
    echo "Already running switch to client" >> $BASEDIR/tmp/run.log
  else
    echo "running switch";
    echo "sudo $BASEDIR/switch-to-wifi-client.sh" | bash
  fi
  sleep 45s
done
echo "sudo $BASEDIR/kill-switch-network.sh" | bash
echo "sudo $BASEDIR/reboot.sh" | bash
echo "Update to Wifi Client mode"
