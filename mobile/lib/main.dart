import 'dart:convert';
import 'dart:io' show Platform;
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

/// محاكي Android: 10.0.2.2 | محاكي iOS: localhost | جهاز حقيقي: مرّر العنوان
/// flutter run --dart-define=API_URL=http://192.168.1.10:3000
const _envUrl = String.fromEnvironment('API_URL');
final String apiUrl = _envUrl.isNotEmpty ? _envUrl : (Platform.isAndroid ? 'http://10.0.2.2:3000' : 'http://localhost:3000');

class Api {
  static String? token;
  static Future<dynamic> call(String method, String path, [Map<String, dynamic>? body]) async {
    final req = http.Request(method, Uri.parse('$apiUrl$path'));
    req.headers['content-type'] = 'application/json';
    if (token != null) req.headers['authorization'] = 'Bearer $token';
    if (body != null) req.body = jsonEncode(body);
    http.Response res;
    try {
      res = await http.Response.fromStream(await req.send().timeout(const Duration(seconds: 15)));
    } catch (_) {
      throw 'تعذر الاتصال بالخادم، تأكد من الشبكة وعنوان API';
    }
    final data = res.body.isEmpty ? null : jsonDecode(utf8.decode(res.bodyBytes));
    if (res.statusCode >= 400) throw (data is Map ? data['error'] : 'حدث خطأ').toString();
    return data;
  }
}

void main() => runApp(const App());

class App extends StatelessWidget {
  const App({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
        title: 'حجز ملعب',
        debugShowCheckedModeBanner: false,
        theme: ThemeData(colorSchemeSeed: Colors.green, useMaterial3: true),
        builder: (c, w) => Directionality(textDirection: TextDirection.rtl, child: w!),
        home: const Boot(),
      );
}

class Boot extends StatefulWidget {
  const Boot({super.key});
  @override
  State<Boot> createState() => _BootState();
}

class _BootState extends State<Boot> {
  bool? loggedIn;
  @override
  void initState() {
    super.initState();
    _init();
  }

  Future<void> _init() async {
    final sp = await SharedPreferences.getInstance();
    Api.token = sp.getString('token');
    setState(() => loggedIn = Api.token != null);
  }

  Future<void> _set(String? t) async {
    final sp = await SharedPreferences.getInstance();
    Api.token = t;
    if (t == null) {
      await sp.remove('token');
    } else {
      await sp.setString('token', t);
    }
    setState(() => loggedIn = t != null);
  }

  @override
  Widget build(BuildContext context) {
    if (loggedIn == null) return const Scaffold(body: Center(child: CircularProgressIndicator()));
    return loggedIn! ? Home(onLogout: () => _set(null)) : AuthPage(onToken: _set);
  }
}

class AuthPage extends StatefulWidget {
  final Future<void> Function(String) onToken;
  const AuthPage({super.key, required this.onToken});
  @override
  State<AuthPage> createState() => _AuthPageState();
}

class _AuthPageState extends State<AuthPage> {
  final name = TextEditingController(), email = TextEditingController(), phone = TextEditingController(), pw = TextEditingController();
  bool reg = false, busy = false;
  String? err;

  Future<void> submit() async {
    setState(() { busy = true; err = null; });
    try {
      final d = await Api.call('POST', reg ? '/api/register' : '/api/login',
          {'name': name.text, 'email': email.text, 'phone': phone.text, 'password': pw.text});
      await widget.onToken(d['token']);
      return;
    } catch (e) {
      err = e.toString();
    }
    if (mounted) setState(() => busy = false);
  }

  Widget field(TextEditingController c, String label, {bool secret = false, TextInputType? type}) => Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: TextField(controller: c, obscureText: secret, keyboardType: type, decoration: InputDecoration(labelText: label, border: const OutlineInputBorder())),
      );

  @override
  Widget build(BuildContext context) => Scaffold(
        body: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 400),
              child: Column(children: [
                const Icon(Icons.sports_soccer, size: 72, color: Colors.green),
                const SizedBox(height: 8),
                Text(reg ? 'إنشاء حساب' : 'تسجيل الدخول', style: Theme.of(context).textTheme.headlineSmall),
                const SizedBox(height: 20),
                if (reg) field(name, 'الاسم'),
                field(email, 'البريد الإلكتروني', type: TextInputType.emailAddress),
                if (reg) field(phone, 'رقم الهاتف', type: TextInputType.phone),
                field(pw, 'كلمة المرور', secret: true),
                if (err != null) Padding(padding: const EdgeInsets.only(bottom: 8), child: Text(err!, style: const TextStyle(color: Colors.red))),
                SizedBox(width: double.infinity, child: FilledButton(onPressed: busy ? null : submit, child: Text(reg ? 'تسجيل' : 'دخول'))),
                TextButton(onPressed: () => setState(() { reg = !reg; err = null; }), child: Text(reg ? 'لدي حساب بالفعل' : 'مستخدم جديد؟ أنشئ حساب')),
              ]),
            ),
          ),
        ),
      );
}

class Home extends StatefulWidget {
  final VoidCallback onLogout;
  const Home({super.key, required this.onLogout});
  @override
  State<Home> createState() => _HomeState();
}

class _HomeState extends State<Home> {
  int tab = 0;
  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('حجز ملعب'), actions: [IconButton(onPressed: widget.onLogout, icon: const Icon(Icons.logout), tooltip: 'خروج')]),
        body: [BookPage(onAuthLost: widget.onLogout), MyPage(onAuthLost: widget.onLogout), ProfilePage(onLogout: widget.onLogout)][tab],
        bottomNavigationBar: NavigationBar(
          selectedIndex: tab,
          onDestinationSelected: (i) => setState(() => tab = i),
          destinations: const [
            NavigationDestination(icon: Icon(Icons.event_available), label: 'احجز'),
            NavigationDestination(icon: Icon(Icons.list_alt), label: 'حجوزاتي'),
            NavigationDestination(icon: Icon(Icons.person_outline), label: 'حسابي'),
          ],
        ),
      );
}

class BookPage extends StatefulWidget {
  final VoidCallback onAuthLost;
  const BookPage({super.key, required this.onAuthLost});
  @override
  State<BookPage> createState() => _BookPageState();
}

class _BookPageState extends State<BookPage> {
  List pitches = [], hours = [];
  Map? pitch;
  DateTime date = DateTime.now();
  String? err;
  bool loading = true;

  String get ds => '${date.year}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}';

  @override
  void initState() {
    super.initState();
    _loadPitches();
  }

  void _fail(Object e) {
    err = e.toString();
    if (err == 'login required') widget.onAuthLost();
  }

  Future<void> _loadPitches() async {
    try {
      pitches = await Api.call('GET', '/api/pitches');
      if (pitches.isNotEmpty) {
        pitch = pitches.first;
        await _loadHours();
      }
    } catch (e) {
      _fail(e);
    }
    if (mounted) setState(() => loading = false);
  }

  Future<void> _loadHours() async {
    if (pitch == null) return;
    try {
      final d = await Api.call('GET', '/api/availability?pitch_id=${pitch!['id']}&date=$ds');
      hours = d['hours'];
      err = null;
    } catch (e) {
      _fail(e);
    }
    if (mounted) setState(() {});
  }

  Future<void> _book(int h) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('تأكيد الحجز'),
        content: Text('${pitch!['name']}\n$ds - الساعة $h:00\nالسعر: ${pitch!['price']} جنيه'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('إلغاء')),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('تأكيد')),
        ],
      ),
    );
    if (ok != true) return;
    String msg = 'تم الحجز بنجاح';
    try {
      await Api.call('POST', '/api/bookings', {'pitch_id': pitch!['id'], 'date': ds, 'hour': h});
    } catch (e) {
      msg = e.toString();
    }
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
    await _loadHours();
  }

  @override
  Widget build(BuildContext context) {
    if (loading) return const Center(child: CircularProgressIndicator());
    if (pitches.isEmpty) return Center(child: Text(err ?? 'لا توجد ملاعب متاحة'));
    return ListView(padding: const EdgeInsets.all(16), children: [
      InputDecorator(
        decoration: const InputDecoration(labelText: 'الملعب', border: OutlineInputBorder()),
        child: DropdownButtonHideUnderline(
          child: DropdownButton<Map>(
            isExpanded: true,
            value: pitch,
            items: [for (final p in pitches) DropdownMenuItem<Map>(value: p, child: Text('${p['name']} - ${p['price']} جنيه/ساعة'))],
            onChanged: (p) {
              setState(() => pitch = p);
              _loadHours();
            },
          ),
        ),
      ),
      const SizedBox(height: 12),
      OutlinedButton.icon(
        icon: const Icon(Icons.calendar_month),
        label: Text('التاريخ: $ds'),
        onPressed: () async {
          final d = await showDatePicker(context: context, initialDate: date, firstDate: DateTime.now(), lastDate: DateTime.now().add(const Duration(days: 60)));
          if (d != null) { date = d; _loadHours(); }
        },
      ),
      if (err != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(err!, style: const TextStyle(color: Colors.red))),
      const SizedBox(height: 16),
      const Text('المواعيد المتاحة (الأخضر = متاح)'),
      const SizedBox(height: 8),
      Wrap(spacing: 8, runSpacing: 8, children: [
        for (final h in hours)
          FilledButton.tonal(
            onPressed: h['available'] == true ? () => _book(h['hour']) : null,
            child: Text('${h['hour']}:00'),
          ),
      ]),
      if (hours.isNotEmpty && !hours.any((h) => h['available'] == true))
        const Padding(padding: EdgeInsets.only(top: 12), child: Text('لا توجد مواعيد متاحة في هذا اليوم')),
    ]);
  }
}

class MyPage extends StatefulWidget {
  final VoidCallback onAuthLost;
  const MyPage({super.key, required this.onAuthLost});
  @override
  State<MyPage> createState() => _MyPageState();
}

class _MyPageState extends State<MyPage> {
  List items = [];
  String? err;
  bool loading = true;

  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    try {
      items = await Api.call('GET', '/api/bookings/mine');
      err = null;
    } catch (e) {
      err = e.toString();
      if (err == 'login required') widget.onAuthLost();
    }
    if (mounted) setState(() => loading = false);
  }

  Future<void> confirmCancel(int id) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('إلغاء الحجز؟'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('رجوع')),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('إلغاء الحجز')),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await Api.call('DELETE', '/api/bookings/$id');
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
    await load();
  }

  @override
  Widget build(BuildContext context) {
    if (loading) return const Center(child: CircularProgressIndicator());
    return RefreshIndicator(
      onRefresh: load,
      child: ListView(children: [
        if (err != null) Padding(padding: const EdgeInsets.all(16), child: Text(err!, style: const TextStyle(color: Colors.red))),
        if (items.isEmpty && err == null) const Padding(padding: EdgeInsets.all(32), child: Center(child: Text('لا توجد حجوزات'))),
        for (final b in items)
          ListTile(
            leading: Icon(b['status'] == 'confirmed' ? Icons.check_circle : Icons.cancel, color: b['status'] == 'confirmed' ? Colors.green : Colors.red),
            title: Text('${b['pitch_name']}'),
            subtitle: Text('${b['date']} - ${b['hour']}:00 - ${b['price']} جنيه - ${b['status'] == 'confirmed' ? 'مؤكد' : 'ملغي'}'),
            trailing: b['status'] != 'confirmed'
                ? null
                : b['can_cancel'] == true
                    ? IconButton(icon: const Icon(Icons.delete_outline), tooltip: 'إلغاء', onPressed: () => confirmCancel(b['id']))
                    : const Tooltip(message: 'لا يمكن الإلغاء قبل الموعد بأقل من ساعتين', child: Icon(Icons.lock_outline)),
          ),
      ]),
    );
  }
}

class ProfilePage extends StatefulWidget {
  final VoidCallback onLogout;
  const ProfilePage({super.key, required this.onLogout});
  @override
  State<ProfilePage> createState() => _ProfilePageState();
}

class _ProfilePageState extends State<ProfilePage> {
  final name = TextEditingController(), phone = TextEditingController();
  final oldPw = TextEditingController(), newPw = TextEditingController();
  String email = '';
  bool loading = true;

  @override
  void initState() {
    super.initState();
    load();
  }

  void snack(String m) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));
  }

  Future<void> load() async {
    try {
      final d = await Api.call('GET', '/api/me');
      name.text = d['name'] ?? '';
      phone.text = d['phone'] ?? '';
      email = d['email'] ?? '';
    } catch (e) {
      if (e.toString() == 'login required') {
        widget.onLogout();
        return;
      }
      snack(e.toString());
    }
    if (mounted) setState(() => loading = false);
  }

  Future<void> save() async {
    try {
      await Api.call('PUT', '/api/me', {'name': name.text, 'phone': phone.text});
      snack('تم حفظ البيانات');
    } catch (e) {
      snack(e.toString());
    }
  }

  Future<void> changePw() async {
    try {
      await Api.call('PUT', '/api/me/password', {'old_password': oldPw.text, 'new_password': newPw.text});
      oldPw.clear();
      newPw.clear();
      snack('تم تغيير كلمة المرور');
    } catch (e) {
      snack(e.toString());
    }
  }

  @override
  Widget build(BuildContext context) {
    if (loading) return const Center(child: CircularProgressIndicator());
    Widget tf(TextEditingController c, String l, {bool secret = false, TextInputType? t}) => Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: TextField(controller: c, obscureText: secret, keyboardType: t, decoration: InputDecoration(labelText: l, border: const OutlineInputBorder())),
        );
    return ListView(padding: const EdgeInsets.all(16), children: [
      ListTile(leading: const Icon(Icons.email_outlined), title: Text(email), subtitle: const Text('البريد الإلكتروني')),
      tf(name, 'الاسم'),
      tf(phone, 'رقم الهاتف', t: TextInputType.phone),
      FilledButton(onPressed: save, child: const Text('حفظ البيانات')),
      const Divider(height: 40),
      Text('تغيير كلمة المرور', style: Theme.of(context).textTheme.titleMedium),
      const SizedBox(height: 12),
      tf(oldPw, 'كلمة المرور الحالية', secret: true),
      tf(newPw, 'كلمة المرور الجديدة (6 أحرف على الأقل)', secret: true),
      OutlinedButton(onPressed: changePw, child: const Text('تغيير')),
      const Divider(height: 40),
      TextButton.icon(onPressed: widget.onLogout, icon: const Icon(Icons.logout), label: const Text('تسجيل الخروج')),
    ]);
  }
}
