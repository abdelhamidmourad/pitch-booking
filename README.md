# تطبيق حجز ملعب كرة قدم (نجيل صناعي)

```
pitch-booking/
├── backend/     API (Node 22 + SQLite المدمج، بدون أي مكتبات خارجية) + اختبارات
├── dashboard/   لوحة تحكم الإدارة (HTML واحد، يُخدَّم من الـ Backend على /admin)
├── web/         نسخة ويب للموبايل (تُخدَّم من الـ Backend على /)
└── mobile/      تطبيق Flutter (Android + iOS)
```

## 1) تشغيل الـ Backend + لوحة التحكم
المتطلبات: Node.js 22.13 أو أحدث.
```
cd backend
npm test        # 6 اختبارات
npm start       # http://localhost:3000
```
- **لوحة التحكم:** http://localhost:3000/admin
- **حساب الإدارة الافتراضي:** `admin@pitch.local` / `admin123`
- **غيّره قبل النشر:** `ADMIN_EMAIL=you@x.com ADMIN_PASSWORD=كلمة_قوية JWT_SECRET=سر_عشوائي_طويل npm start`
  (الأدمن بيتنشأ أول تشغيل فقط؛ لو عملت قاعدة البيانات قبل كده امسح `backend/data.db` أو غيّر الباسورد منها.)
- متغيرات أخرى: `PORT`, `DB_FILE`.

## 1-ب) نسخة الويب على الموبايل (بدون تثبيت أي شيء)
بعد `npm start` يطبع السيرفر عنوانًا مثل `http://192.168.1.20:3000`. افتحه من متصفح الموبايل (نفس الـ Wi-Fi، واسمح لـ Node في جدار حماية Windows).
Android: قائمة Chrome ← «إضافة إلى الشاشة الرئيسية». iPhone: Safari ← مشاركة ← «إضافة إلى الشاشة الرئيسية».
الاتصال HTTP على الشبكة المحلية للتجربة فقط؛ للاستخدام الحقيقي استضِف السيرفر خلف HTTPS.

## 2) تشغيل تطبيق Flutter على الموبايل
المتطلبات: Flutter SDK 3.x + Android Studio (أو Xcode للـ iOS).
**الأسرع:** `cd mobile && bash setup.sh` (يولّد android/ios ويضيف إعدادات HTTP ويشغّل `pub get`)، ثم `flutter run` بالعنوان المناسب أدناه. الخطوات اليدوية بعده للمرجع.
```
cd mobile
flutter create --project-name pitch_booking .   # يولّد مجلدات android/ و ios/ (تأكد أن lib/main.dart لم يتغير)
flutter pub get
```
**عنوان الـ API (مهم):**
- محاكي Android: افتراضي `http://10.0.2.2:3000`. محاكي iOS: افتراضي `http://localhost:3000`. لا تحتاج أي مُعامل.
- جهاز حقيقي (Android أو iPhone): نفس شبكة الـ Wi-Fi مع الكمبيوتر، وشغّل
  `flutter run --dart-define=API_URL=http://<IP-الكمبيوتر>:3000` (الـ IP من `ipconfig` أو `ifconfig`).
  تأكد أن جدار الحماية يسمح بالمنفذ 3000.
- Android عبر USB بدون IP: `adb reverse tcp:3000 tcp:3000` ثم `--dart-define=API_URL=http://localhost:3000`.
- iPhone حقيقي: فعّل Developer Mode في الإعدادات، وافتح `ios/Runner.xcworkspace` في Xcode واختر Team للتوقيع، ووافق على إذن «الشبكة المحلية» عند أول تشغيل.

**إعدادات لازمة لأن الاتصال HTTP (للتجربة):**
- Android: في `android/app/src/main/AndroidManifest.xml` أضف قبل `<application`:
  `<uses-permission android:name="android.permission.INTERNET"/>` وداخل `<application` أضف `android:usesCleartextTraffic="true"`.
- iOS: في `ios/Runner/Info.plist` أضف `NSAppTransportSecurity` ثم `NSAllowsArbitraryLoads` بقيمة `true`. وبناء iOS يتطلب Mac + Xcode.
- للإنتاج: استخدم HTTPS وأزل الإعدادين.

**تجميع نسخة:** `flutter build apk --dart-define=API_URL=https://your-domain` (Android) أو `flutter build ios ...`.
احذف `test/widget_test.dart` الذي يولده `flutter create` لأنه يشير لكلاس غير موجود.

## 3) النشر على الإنترنت (HTTPS)
الملفات الجاهزة: `Dockerfile` و`render.yaml` (لم تُجرَّب هنا لعدم توفر Docker وشبكة؛ الكود نفسه واختبارات الإنتاج اتجرّبت محليًا).
1. ارفع مجلد المشروع كاملًا على مستودع GitHub (الـ Dockerfile في الجذر).
2. على render.com: New ← Blueprint ← اختر المستودع ← اكتب `ADMIN_PASSWORD` ← Apply.
3. بعد النشر تحصل على رابط `https://اسمك.onrender.com`: افتحه من الموبايل (واجهة الحجز)، و`/admin` للإدارة.
4. تطبيق Flutter: `flutter run --dart-define=API_URL=https://اسمك.onrender.com` (مع HTTPS تقدر تزيل إعدادات HTTP).
**تنبيه مهم:** القاعدة SQLite داخل الحاوية. على الخطة المجانية غالبًا يتم مسح الملفات عند إعادة التشغيل/النشر ويتوقف الخادم عند الخمول، فالبيانات مناسبة للتجربة فقط (راجع شروط الخطة الحالية). للاستخدام الفعلي: استضافة بقرص دائم (Volume) مثبّت على `/data`.
متغيرات البيئة: `JWT_SECRET` (16+ حرف) و`ADMIN_PASSWORD` (8+) إلزاميان عند `NODE_ENV=production`، و`DB_FILE`, `PORT`, `CANCEL_HOURS`, `LOGIN_LIMIT` (افتراضي 10 محاولات/15 دقيقة), `TRUST_PROXY=1` فقط خلف وسيط موثوق.

## الميزات
- المستخدم: تسجيل/دخول، اختيار الملعب والتاريخ، رؤية المواعيد المتاحة، حجز، عرض وإلغاء حجوزاته.
- منع الحجز المزدوج على مستوى قاعدة البيانات (فهرس فريد على الملعب+التاريخ+الساعة للحجوزات المؤكدة).
- الإدارة: إحصائيات، كل الحجوزات مع تصفية بالتاريخ وإلغاء، إضافة الملاعب وتفعيلها/إيقافها.

- الموبايل: تبويب «حسابي» (تعديل الاسم والهاتف، تغيير كلمة المرور، خروج)، وإلغاء الحجز مع تأكيد.
- سياسة الإلغاء: المستخدم لا يلغي قبل الموعد بأقل من ساعتين (`CANCEL_HOURS`)، والإدارة مستثناة.
- الإدارة: قائمة المستخدمين وتعديل اسم/سعر الملعب.
- نقاط جديدة: `GET/PUT /api/me`, `PUT /api/me/password`, `GET /api/admin/users`، وحقل `can_cancel` في `/api/bookings/mine`.

## حدود النسخة (MVP)
لا يوجد دفع إلكتروني ولا إشعارات ولا استرجاع كلمة المرور. المواعيد بالساعة حسب توقيت الخادم.
