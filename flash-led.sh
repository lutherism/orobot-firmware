status="1"

for i in $(seq 1 10)
do
  if [ $status -eq "1" ]; then
    status="0"
  else
    status="1"
  fi
  echo "toggle $i"
  echo $status | sudo tee /sys/class/leds/led0/brightness
  sleep .5s
done
echo 1 | sudo tee /sys/class/leds/led0/brightness
