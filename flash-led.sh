status="1"

while [ 1 ]
do
  if [ $status -eq "1" ]; then
    status="0"
  else
    status="1"
  fi
  echo "toggle $i"
  echo $status | sudo tee /sys/class/leds/led0/brightness
  sleep .05s
done
