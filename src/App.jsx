import React, { useState, useEffect, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, query, onSnapshot, addDoc, deleteDoc, doc, Timestamp, orderBy } from 'firebase/firestore';
import { 
  PlusCircle, Trash2, TrendingUp, TrendingDown, Wallet, 
  Camera, FileSpreadsheet, Image as ImageIcon, ScanText, 
  ChevronLeft, ChevronRight, Loader2, X, Calendar
} from 'lucide-react';

/**
 * 环境变量读取逻辑：
 * 兼容 Vercel (import.meta.env) 和 预览环境 (__firebase_config)
 */
const getEnv = (key) => {
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env[key]) {
      return import.meta.env[key];
    }
  } catch (e) {}
  return "";
};

const getFirebaseConfig = () => {
  if (typeof __firebase_config !== 'undefined') {
    return JSON.parse(__firebase_config);
  }
  return {
    apiKey: getEnv('VITE_FIREBASE_API_KEY'),
    authDomain: getEnv('VITE_FIREBASE_AUTH_DOMAIN'),
    projectId: getEnv('VITE_FIREBASE_PROJECT_ID'),
    storageBucket: getEnv('VITE_FIREBASE_STORAGE_BUCKET'),
    messagingSenderId: getEnv('VITE_FIREBASE_MESSAGING_SENDER_ID'),
    appId: getEnv('VITE_FIREBASE_APP_ID')
  };
};

// 初始化 Firebase
const firebaseConfig = getFirebaseConfig();
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'baking-app-default';
const GEMINI_API_KEY = getEnv('VITE_GEMINI_API_KEY');

// --- 业务配置 ---
const CURRENCY = "AED";
const INCOME_STRUCTURE = {
  "蛋糕": { sub: ["水果奶油", "豆乳香芋", "奥利奥咸奶油", "其它"], hasSize: true },
  "甜品": { sub: ["纸杯蛋糕", "花酥", "马卡龙", "其它"], hasSize: false },
  "烘焙课程": { sub: ["初级", "中级", "高级"], hasSize: false }
};
const EXPENSE_CATEGORIES = ["原材料", "乳制品", "包装", "房租水电", "其它"];
const CAKE_SIZES = ["4寸", "6寸", "8寸", "10寸"];

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState([]);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [amount, setAmount] = useState('');
  const [type, setType] = useState('income');
  const [mainCat, setMainCat] = useState("蛋糕");
  const [subCat, setSubCat] = useState(INCOME_STRUCTURE["蛋糕"].sub[0]);
  const [cakeSize, setCakeSize] = useState(CAKE_SIZES[1]);
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState(null);
  const [isScanning, setIsScanning] = useState(false);

  // 1. 登录逻辑
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) { console.error(err); }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, (u) => { setUser(u); setLoading(false); });
    return () => unsubscribe();
  }, []);

  // 2. 监听数据
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'artifacts', appId, 'users', user.uid, 'records'), orderBy('date', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setRecords(snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        date: doc.data().date?.toDate() || new Date()
      })));
    });
    return () => unsubscribe();
  }, [user]);

  // 3. 计算统计
  const filteredRecords = useMemo(() => {
    return records.filter(r => 
      r.date.getMonth() === currentMonth.getMonth() && 
      r.date.getFullYear() === currentMonth.getFullYear()
    );
  }, [records, currentMonth]);

  const stats = useMemo(() => {
    return filteredRecords.reduce((acc, curr) => {
      const val = parseFloat(curr.amount) || 0;
      if (curr.type === 'income') acc.income += val;
      else acc.expense += val;
      return acc;
    }, { income: 0, expense: 0 });
  }, [filteredRecords]);

  // 4. 操作函数
  const handleCapture = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setPhoto(reader.result);
      reader.readAsDataURL(file);
    }
  };

  const saveRecord = async (e) => {
    e.preventDefault();
    if (!amount || !user) return;
    await addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'records'), {
      type, amount: parseFloat(amount), mainCat, subCat, 
      cakeSize: type === 'income' ? cakeSize : null,
      note, photo, date: Timestamp.now()
    });
    setAmount(''); setNote(''); setPhoto(null);
  };

  const deleteRecord = async (id) => {
    await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'records', id));
  };

  if (loading) return <div className="h-screen flex items-center justify-center bg-orange-50"><Loader2 className="animate-spin text-amber-600" /></div>;

  return (
    <div className="min-h-screen bg-orange-50 p-4 font-sans text-slate-900">
      <div className="max-w-4xl mx-auto space-y-6">
        <header className="flex justify-between items-center">
          <h1 className="text-2xl font-black text-amber-900">家庭烘焙收支管理</h1>
          <div className="bg-white px-4 py-2 rounded-full shadow-sm flex items-center gap-3">
             <button onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth()-1))}><ChevronLeft size={20}/></button>
             <span className="font-bold">{currentMonth.getFullYear()}年{currentMonth.getMonth()+1}月</span>
             <button onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth()+1))}><ChevronRight size={20}/></button>
          </div>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
          <div className="bg-white p-4 rounded-2xl shadow-sm border-b-4 border-amber-400">
            <p className="text-xs font-bold text-slate-400 uppercase">净利润</p>
            <p className="text-xl font-black">{(stats.income - stats.expense).toFixed(2)}</p>
          </div>
          <div className="bg-white p-4 rounded-2xl shadow-sm border-b-4 border-emerald-400">
            <p className="text-xs font-bold text-slate-400 uppercase">总收入</p>
            <p className="text-xl font-black text-emerald-600">{stats.income.toFixed(2)}</p>
          </div>
          <div className="bg-white p-4 rounded-2xl shadow-sm border-b-4 border-rose-400">
            <p className="text-xs font-bold text-slate-400 uppercase">总支出</p>
            <p className="text-xl font-black text-rose-600">{stats.expense.toFixed(2)}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <form onSubmit={saveRecord} className="bg-white p-6 rounded-3xl shadow-lg space-y-4">
            <div className="flex bg-slate-100 p-1 rounded-xl">
              <button type="button" onClick={() => setType('income')} className={`flex-1 py-2 rounded-lg font-bold ${type === 'income' ? 'bg-white shadow text-amber-600' : 'text-slate-400'}`}>收入</button>
              <button type="button" onClick={() => setType('expense')} className={`flex-1 py-2 rounded-lg font-bold ${type === 'expense' ? 'bg-white shadow text-rose-500' : 'text-slate-400'}`}>支出</button>
            </div>
            
            <input type="number" step="0.01" required value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00 AED" className="w-full text-2xl font-black p-4 bg-slate-50 rounded-xl border-none focus:ring-2 focus:ring-amber-400" />
            
            <div className="grid grid-cols-2 gap-2">
              <select value={mainCat} onChange={e => { setMainCat(e.target.value); if(type==='income') setSubCat(INCOME_STRUCTURE[e.target.value].sub[0]); }} className="p-3 bg-slate-50 rounded-xl border-none text-sm">
                {type === 'income' ? Object.keys(INCOME_STRUCTURE).map(c => <option key={c}>{c}</option>) : EXPENSE_CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
              {type === 'income' && (
                <select value={subCat} onChange={e => setSubCat(e.target.value)} className="p-3 bg-slate-50 rounded-xl border-none text-sm">
                  {INCOME_STRUCTURE[mainCat]?.sub.map(c => <option key={c}>{c}</option>)}
                </select>
              )}
            </div>

            <div className="flex gap-2">
              <div className="flex-1 h-20 border-2 border-dashed border-slate-200 rounded-xl relative flex flex-col items-center justify-center overflow-hidden">
                {photo ? <img src={photo} className="absolute inset-0 w-full h-full object-cover" /> : <Camera className="text-slate-300" />}
                <input type="file" accept="image/*" capture="environment" onChange={handleCapture} className="absolute inset-0 opacity-0" />
              </div>
              <button type="submit" className="flex-[2] bg-amber-500 text-white font-black rounded-xl shadow-lg">保存记录</button>
            </div>
          </form>

          <div className="bg-white rounded-3xl shadow-sm overflow-hidden border border-amber-100">
            <div className="p-4 bg-amber-50 font-bold text-amber-900 border-b border-amber-100 flex items-center gap-2"><Calendar size={18}/> 明细列表</div>
            <div className="max-h-[400px] overflow-y-auto divide-y divide-slate-50">
              {filteredRecords.map(r => (
                <div key={r.id} className="p-4 flex items-center gap-4 group">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold ${r.type === 'income' ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600'}`}>{r.date.getDate()}</div>
                  <div className="flex-1">
                    <p className="font-bold text-sm">{r.mainCat}</p>
                    <p className="text-xs text-slate-400">{r.note || '无备注'}</p>
                  </div>
                  <p className={`font-black ${r.type === 'income' ? 'text-emerald-600' : 'text-rose-600'}`}>{r.type==='income'?'+':'-'}{r.amount}</p>
                  <button onClick={() => deleteRecord(r.id)} className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-rose-500 transition"><Trash2 size={16}/></button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
