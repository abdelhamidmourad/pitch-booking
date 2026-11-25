#!/usr/bin/env bash
# تشغيل من داخل mobile/ :  bash setup.sh   (يحتاج Flutter SDK؛ على Mac يلزم Xcode لـ iOS)
# يولّد android/ و ios/ ويفعّل HTTP + صلاحية الشبكة المحلية للتجربة ثم ينزّل الحزم.
set -e
if [ ! -d android ] && [ ! -d ios ]; then
  BAK="$(mktemp -d)"; cp lib/main.dart pubspec.yaml "$BAK"/
  flutter create --project-name pitch_booking .
  cp "$BAK"/main.dart lib/main.dart; cp "$BAK"/pubspec.yaml pubspec.yaml   # لا نسمح لـ flutter create بتغيير ملفاتنا
  rm -f test/widget_test.dart
fi
M=android/app/src/main/AndroidManifest.xml
if [ -f "$M" ] && ! grep -q usesCleartextTraffic "$M"; then
  perl -0pi -e 's#<application#<uses-permission android:name="android.permission.INTERNET"/>\n    <application android:usesCleartextTraffic="true"#' "$M"
fi
P=ios/Runner/Info.plist
if [ -f "$P" ] && ! grep -q NSAllowsArbitraryLoads "$P"; then
  perl -0pi -e 's#</dict>\s*</plist>#\t<key>NSAppTransportSecurity</key>\n\t<dict><key>NSAllowsArbitraryLoads</key><true/></dict>\n\t<key>NSLocalNetworkUsageDescription</key>\n\t<string>للاتصال بخادم الحجز على الشبكة المحلية أثناء التطوير</string>\n</dict>\n</plist>#' "$P"
fi
flutter pub get
echo "تم. محاكي Android/iOS: flutter run   |   جهاز حقيقي: flutter run --dart-define=API_URL=http://<IP-الكمبيوتر>:3000"
