#!/system/bin/sh
umask 077
export PATH=/system/bin:/system/xbin:/data/local/frame
export ANDROID_ROOT=/system ANDROID_DATA=/data
export LD_LIBRARY_PATH=/vendor/lib:/system/lib
export BOOTCLASSPATH=/system/framework/core.jar:/system/framework/conscrypt.jar:/system/framework/okhttp.jar:/system/framework/core-junit.jar:/system/framework/bouncycastle.jar:/system/framework/ext.jar:/system/framework/framework.jar:/system/framework/framework2.jar:/system/framework/telephony-common.jar:/system/framework/voip-common.jar:/system/framework/mms-common.jar:/system/framework/android.policy.jar:/system/framework/services.jar:/system/framework/apache-xml.jar:/system/framework/webviewchromium.jar
if test -s /data/local/frame/dropbear.pid; then
  pid=$(cat /data/local/frame/dropbear.pid)
  if test "$(/system/bin/busybox readlink /proc/$pid/exe)" = /data/local/frame/dropbear; then exit 0; fi
fi
exec /system/bin/busybox nohup /data/local/frame/dropbear -e -W 1048576 -p 22 -r /data/local/frame/host_ed25519 -P /data/local/frame/dropbear.pid >>/data/local/frame/ssh.log 2>&1
