for i in {1..10}
status="1"
do
  if [[status == "1"]]; then
    status="0"
  else
    status="1"
  fi
  echo $status | sudo tee /sys/class/leds/led0/brightness
  sleep .05s
done
echo 1 | sudo tee /sys/class/leds/led0/brightness
