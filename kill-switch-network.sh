ps -ax | grep 'switch-to' | awk '{print $1}' | xargs kill
ps -ax | grep 'dhclient' | awk '{print $1}' | xargs kill
