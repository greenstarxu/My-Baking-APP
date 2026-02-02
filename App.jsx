import React, { useState, useEffect, useMemo, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, query, onSnapshot, addDoc, deleteDoc, doc, Timestamp, orderBy } from 'firebase/firestore';
import { 
  PlusCircle, Trash2, TrendingUp, TrendingDown, Wallet, 
  Camera, FileSpreadsheet, Image as ImageIcon, ScanText, 
  ChevronLeft, ChevronRight, Loader2, X, Check, Save,
  Calendar
} from 'lucide-react';

/**
 * 注意：当你部署到 GitHub/Vercel 时：
 * 1. 请确保在本地环境中安装了依赖: npm install firebase lucide-react xlsx tailwindcss
 * 2. __firebase_config 和 __app_id 是当前预览环境特有的。
 * 3. 在生产环境中，你应该手动替换下面的 config 对象。
 */

const firebaseConfig = typeof __firebase_config !== 'undefined' 
  ? JSON.parse(__firebase_config) 
  : {
      apiKey: "YOUR_API_KEY",
      authDomain: "YOUR_AUTH_DOMAIN",
      projectId: "YOUR_PROJECT_ID",
      storageBucket: "YOUR_STORAGE_BUCKET",
      messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
      appId: "YOUR_APP_ID"
    };

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'baking-shop-manager';
const GEMINI_API_KEY = ""; // 如果需要OCR功能，请在此处填写 Gemini API Key

// --- 常量定义 ---
const CURRENCY = "AED";
const INCOME_STRUCTURE = {
  "蛋糕": {
    sub: ["水果奶油蛋糕", "豆乳香芋蛋糕", "奥利奥咸奶油蛋糕", "伯爵草莓蛋糕", "抹茶红豆乳蛋糕", "巧克力开心果蛋糕", "板栗蛋糕", "其它"],
    hasSize: true
  },
  "甜品": {
    sub: ["纸杯蛋糕", "花酥", "马卡龙", "其它"],
    hasSize: false
  },
  "烘焙课程": {
    sub: ["初级烘焙课", "中级烘焙课", "高级烘焙课", "其它"],
    hasSize: false
  }
};

const EXPENSE_CATEGORIES = [
  "基础主材（面粉类、糖类）", "乳制品 & 油脂类", "新鲜水果", "鸡蛋", "巧克力", "装饰材料", "包装材料", "其它"
];

const CAKE_SIZES = ["4寸", "6寸", "8寸", "10寸", "12寸"];

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState([]);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  
  // 表单状态
  const [type, setType] = useState('income');
  const [amount, setAmount] = useState('');
  const [mainCat, setMainCat] = useState("蛋糕");
  const [subCat, setSubCat] = useState(INCOME_STRUCTURE["蛋糕"].sub[0]);
  const [cakeSize, setCakeSize] = useState(CAKE_SIZES[1]); 
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState(null);
  const [isScanning, setIsScanning] = useState(false);
  
  // 动态加载 XLSX 库用于导出 Excel
  const loadXLSX = () => {
    return new Promise((resolve, reject) => {
      if (window.XLSX) return resolve(window.XLSX);
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      script.onload = () => resolve(window.XLSX);
      script.onerror = reject;
      document.head.appendChild(script);
    });
  };

  // 1. 身份验证与 Firebase 初始化
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) {
        console.error("Firebase 认证失败", err);
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, (u) => { 
      setUser(u); 
      setLoading(false); 
    });
    return () => unsubscribe();
  }, []);

  // 2. 实时监听数据库变化
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'artifacts', appId, 'users', user.uid, 'records'), orderBy('date', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setRecords(snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        date: doc.data().date?.toDate() || new Date()
      })));
    }, (err) => console.error("读取数据错误:", err));
    return () => unsubscribe();
  }, [user]);

  // 3. 数据过滤与统计
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

  // 4. 图片处理与 AI 小票识别
  const handleCapture = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => setPhoto(reader.result);
    reader.readAsDataURL(file);
  };

  const scanReceipt = async (base64Image) => {
    if (!GEMINI_API_KEY) {
      alert("请先在代码中配置 Gemini API Key 以启用此功能。");
      return;
    }
    setIsScanning(true);
    const base64Data = base64Image.split(',')[1];
    
    const prompt = `你是一个小票识别助手。请识别这张烘焙原材料采购小票中的商品条目、单价、数量和总金额。请以JSON格式返回：{ "items": [{ "name": "string", "price": number, "qty": number }], "total": number }。只返回JSON数据，不要有任何其他解释。`;
    
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inlineData: { mimeType: "image/png", data: base64Data } }
            ]
          }]
        })
      });
      const result = await response.json();
      const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
      const jsonStr = text.match(/\{.*\}/s)?.[0];
      if (jsonStr) {
        const parsed = JSON.parse(jsonStr);
        setAmount(parsed.total.toString());
        setNote(`小票识别: ${parsed.items.map(i => i.name).join(', ')}`);
        setType('expense');
        setMainCat(EXPENSE_CATEGORIES[0]);
      }
    } catch (error) {
      console.error("识别小票失败", error);
    } finally {
      setIsScanning(false);
    }
  };

  // 5. 导出 Excel 功能
  const exportToExcel = async () => {
    try {
      const XLSX_LIB = await loadXLSX();
      const data = filteredRecords.map(r => ({
        "日期": r.date.toLocaleDateString(),
        "类型": r.type === 'income' ? '收入' : '支出',
        "一级分类": r.mainCat,
        "二级分类/明细": r.subCat || '',
        "尺寸": r.cakeSize || '-',
        "金额 (AED)": r.amount,
        "备注": r.note || ''
      }));

      const ws = XLSX_LIB.utils.json_to_sheet(data);
      const wb = XLSX_LIB.utils.book_new();
      XLSX_LIB.utils.book_append_sheet(wb, ws, "收支明细");
      XLSX_LIB.writeFile(wb, `烘焙店报表_${currentMonth.getFullYear()}_${currentMonth.getMonth()+1}.xlsx`);
    } catch (error) {
      console.error("导出失败", error);
    }
  };

  // 6. 保存与删除记录
  const saveRecord = async (e) => {
    e.preventDefault();
    if (!amount || !user) return;
    
    try {
      await addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'records'), {
        type,
        amount: parseFloat(amount),
        mainCat,
        subCat: type === 'income' ? subCat : '',
        cakeSize: (type === 'income' && INCOME_STRUCTURE[mainCat]?.hasSize) ? cakeSize : null,
        note,
        photo,
        date: Timestamp.fromDate(new Date()),
        createdAt: Timestamp.now()
      });
      setAmount(''); setNote(''); setPhoto(null);
    } catch (err) {
      console.error("保存失败", err);
    }
  };

  const deleteRecord = async (id) => {
    if (!user) return;
    try {
      await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'records', id));
    } catch (err) {
      console.error("删除失败", err);
    }
  };

  if (loading) return (
    <div className="h-screen flex items-center justify-center bg-orange-50">
      <Loader2 className="animate-spin text-amber-600 h-10 w-10" />
    </div>
  );

  return (
    <div className="min-h-screen bg-orange-50 text-slate-900 p-4 md:p-6 font-sans">
      <div className="max-w-4xl mx-auto space-y-6">
        
        {/* 页眉 */}
        <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-3xl font-black text-amber-900 tracking-tight">家庭烘焙收支管理</h1>
            <p className="text-amber-700/60 font-medium text-sm">甜点记录生活，账目管理事业</p>
          </div>
          <div className="flex gap-2">
            <button 
              onClick={exportToExcel}
              className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-xl hover:bg-emerald-700 transition shadow-sm font-bold text-sm"
            >
              <FileSpreadsheet size={18} /> 导出 Excel
            </button>
          </div>
        </header>

        {/* 数据面板 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white p-5 rounded-2xl border-2 border-amber-100 shadow-sm">
            <div className="flex items-center gap-3 text-amber-600 mb-2">
              <Wallet size={20} /> <span className="text-xs font-bold uppercase tracking-wider">本月净利</span>
            </div>
            <p className="text-2xl font-black text-slate-800">{(stats.income - stats.expense).toFixed(2)} <span className="text-sm">{CURRENCY}</span></p>
          </div>
          <div className="bg-white p-5 rounded-2xl border-2 border-emerald-50 shadow-sm">
            <div className="flex items-center gap-3 text-emerald-600 mb-2">
              <TrendingUp size={20} /> <span className="text-xs font-bold uppercase tracking-wider">总收入</span>
            </div>
            <p className="text-2xl font-black text-emerald-600">{stats.income.toFixed(2)} <span className="text-sm">{CURRENCY}</span></p>
          </div>
          <div className="bg-white p-5 rounded-2xl border-2 border-rose-50 shadow-sm">
            <div className="flex items-center gap-3 text-rose-600 mb-2">
              <TrendingDown size={20} /> <span className="text-xs font-bold uppercase tracking-wider">总支出</span>
            </div>
            <p className="text-2xl font-black text-rose-600">{stats.expense.toFixed(2)} <span className="text-sm">{CURRENCY}</span></p>
          </div>
        </div>

        {/* 月份选择器 */}
        <div className="flex justify-center">
           <div className="flex items-center bg-white rounded-full px-4 py-2 shadow-sm border border-amber-100">
              <button onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1))} className="p-1 hover:bg-amber-50 rounded-full"><ChevronLeft size={20}/></button>
              <span className="px-6 font-bold text-amber-900 min-w-[120px] text-center">{currentMonth.getFullYear()}年{currentMonth.getMonth()+1}月</span>
              <button onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1))} className="p-1 hover:bg-amber-50 rounded-full"><ChevronRight size={20}/></button>
           </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* 记录表单 */}
          <div className="lg:col-span-5">
            <form onSubmit={saveRecord} className="bg-white rounded-3xl p-6 shadow-xl border-t-4 border-amber-400 space-y-5">
              <div className="flex bg-orange-50 p-1 rounded-2xl">
                <button type="button" onClick={() => { setType('income'); setMainCat("蛋糕"); setSubCat(INCOME_STRUCTURE["蛋糕"].sub[0]); }} className={`flex-1 py-2.5 rounded-xl font-bold text-sm transition ${type === 'income' ? 'bg-white shadow-md text-amber-600' : 'text-slate-400'}`}>收入</button>
                <button type="button" onClick={() => { setType('expense'); setMainCat(EXPENSE_CATEGORIES[0]); }} className={`flex-1 py-2.5 rounded-xl font-bold text-sm transition ${type === 'expense' ? 'bg-white shadow-md text-rose-500' : 'text-slate-400'}`}>支出</button>
              </div>

              <div className="space-y-4">
                <div className="relative">
                  <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">金额 ({CURRENCY})</label>
                  <input type="number" step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className="w-full text-2xl font-black p-4 bg-slate-50 rounded-2xl border-none focus:ring-2 focus:ring-amber-400" />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">一级分类</label>
                    <select value={mainCat} onChange={(e) => {
                      setMainCat(e.target.value);
                      if(type === 'income') setSubCat(INCOME_STRUCTURE[e.target.value].sub[0]);
                    }} className="w-full p-3 bg-slate-50 rounded-xl border-none text-sm font-bold appearance-none">
                      {type === 'income' ? Object.keys(INCOME_STRUCTURE).map(c => <option key={c} value={c}>{c}</option>) : EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  {type === 'income' && (
                    <div>
                      <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">二级分类</label>
                      <select value={subCat} onChange={(e) => setSubCat(e.target.value)} className="w-full p-3 bg-slate-50 rounded-xl border-none text-sm font-bold appearance-none">
                        {INCOME_STRUCTURE[mainCat]?.sub.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                  )}
                </div>

                {type === 'income' && INCOME_STRUCTURE[mainCat]?.hasSize && (
                   <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase ml-1 text-center block mb-2">选择蛋糕尺寸</label>
                    <div className="flex flex-wrap gap-2 justify-center">
                      {CAKE_SIZES.map(s => (
                        <button key={s} type="button" onClick={() => setCakeSize(s)} className={`px-3 py-1.5 rounded-full text-xs font-bold border-2 transition ${cakeSize === s ? 'bg-amber-100 border-amber-400 text-amber-700' : 'bg-white border-slate-100 text-slate-400'}`}>{s}</button>
                      ))}
                    </div>
                   </div>
                )}

                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">备注说明</label>
                  <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="添加备注..." className="w-full p-3 bg-slate-50 rounded-xl border-none text-sm" />
                </div>

                {/* 附件/拍照部分 */}
                <div className="flex items-center gap-3 py-2">
                  <div className="flex-1 border-2 border-dashed border-slate-200 rounded-2xl p-4 flex flex-col items-center justify-center relative overflow-hidden h-24">
                    {photo ? (
                      <>
                        <img src={photo} className="absolute inset-0 w-full h-full object-cover" />
                        <button type="button" onClick={() => setPhoto(null)} className="absolute top-1 right-1 bg-black/50 text-white p-1 rounded-full z-10"><X size={12}/></button>
                      </>
                    ) : (
                      <div className="text-center text-slate-400">
                        <Camera size={20} className="mx-auto mb-1" />
                        <span className="text-[10px] font-bold">拍摄照片</span>
                      </div>
                    )}
                    <input type="file" accept="image/*" capture="environment" onChange={handleCapture} className="absolute inset-0 opacity-0 cursor-pointer" />
                  </div>

                  {type === 'expense' && (
                    <button 
                      type="button" 
                      disabled={isScanning}
                      onClick={() => photo ? scanReceipt(photo) : alert("请先上传/拍摄小票照片")}
                      className={`flex-1 h-24 border-2 border-dashed rounded-2xl flex flex-col items-center justify-center transition ${isScanning ? 'bg-amber-50 border-amber-400' : 'border-slate-200 text-slate-400 hover:border-amber-300'}`}
                    >
                      {isScanning ? (
                        <Loader2 className="animate-spin text-amber-600" />
                      ) : (
                        <>
                          <ScanText size={20} className="mb-1" />
                          <span className="text-[10px] font-bold uppercase">扫小票识价格</span>
                        </>
                      )}
                    </button>
                  )}
                </div>

                <button type="submit" className={`w-full py-4 rounded-2xl font-black text-white shadow-lg transition transform active:scale-95 ${type === 'income' ? 'bg-amber-500 hover:bg-amber-600' : 'bg-rose-500 hover:bg-rose-600'}`}>
                  保存本次收支
                </button>
              </div>
            </form>
          </div>

          {/* 列表部分 */}
          <div className="lg:col-span-7 space-y-4">
             <div className="bg-white rounded-3xl shadow-sm border border-amber-100 overflow-hidden">
                <div className="p-5 border-b border-amber-50 bg-amber-50/30 flex justify-between items-center">
                  <h3 className="font-black text-amber-900 flex items-center gap-2"><Calendar size={18}/> 本月明细</h3>
                  <span className="text-xs bg-white px-3 py-1 rounded-full font-bold text-amber-600 border border-amber-100">{filteredRecords.length} 笔记录</span>
                </div>
                <div className="max-h-[600px] overflow-y-auto">
                  {filteredRecords.length > 0 ? (
                    <div className="divide-y divide-slate-50">
                      {filteredRecords.map(record => (
                        <div key={record.id} className="p-4 hover:bg-orange-50/30 transition group flex items-center gap-4">
                          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center font-bold text-lg shrink-0 ${record.type === 'income' ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600'}`}>
                            {record.date.getDate()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex justify-between">
                              <h4 className="font-bold text-slate-800 text-sm truncate">{record.mainCat} · {record.subCat || '明细'}</h4>
                              <span className={`font-black text-sm ${record.type === 'income' ? 'text-emerald-600' : 'text-rose-600'}`}>
                                {record.type === 'income' ? '+' : '-'} {Number(record.amount).toFixed(2)}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 mt-1">
                              {record.cakeSize && <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-bold">{record.cakeSize}</span>}
                              <span className="text-xs text-slate-400 truncate">{record.note || '无备注'}</span>
                            </div>
                          </div>
                          {record.photo && (
                             <div className="w-10 h-10 rounded-lg overflow-hidden shrink-0 border border-slate-100">
                                <img src={record.photo} className="w-full h-full object-cover" />
                             </div>
                          )}
                          <button onClick={() => deleteRecord(record.id)} className="opacity-0 group-hover:opacity-100 p-2 text-slate-300 hover:text-rose-500 transition">
                            <Trash2 size={16} />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="py-20 text-center text-slate-400">
                       <ImageIcon size={48} className="mx-auto mb-2 opacity-10" />
                       <p className="text-sm italic">这个月还没有开张哦，加油！</p>
                    </div>
                  )}
                </div>
             </div>

             {/* 盈利分析简报 */}
             <div className="bg-amber-900 text-amber-50 rounded-3xl p-6 shadow-xl relative overflow-hidden">
                <div className="relative z-10 flex justify-between items-center">
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-widest opacity-60 mb-1">年度盈利预测</h4>
                    <p className="text-2xl font-black">{(stats.income * 12).toLocaleString()} <span className="text-xs">{CURRENCY} / 年</span></p>
                  </div>
                  <FileSpreadsheet className="opacity-20" size={40} />
                </div>
                <div className="absolute -bottom-4 -right-4 w-24 h-24 bg-amber-800 rounded-full blur-2xl"></div>
             </div>
          </div>
        </div>

        <footer className="text-center py-6">
           <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">烘焙店云端账本 · 数据由 Firebase 驱动并实时同步</p>
        </footer>

      </div>
    </div>
  );
}
