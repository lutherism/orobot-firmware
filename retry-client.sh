BASEDIR="/home/pi/orobot-firmware"

echo "sudo $BASEDIR/switch-to-wifi-client.sh" | bash
sleep 25s
while [ "$(curl google.com | grep 301)" = "" ]; do
  echo "No network: $(date)"
  if ps ax | grep -v grep | grep "switch-to-wifi-client.sh" > /dev/null
  then
    echo "Already running switch to client" >> $BASEDIR/tmp/run.log
  else
    echo "running switch";
    echo "sudo $BASEDIR/switch-to-wifi-client.sh" | bash
  fi
  sleep 25s
done
echo "Update to Wifi Client mode"
