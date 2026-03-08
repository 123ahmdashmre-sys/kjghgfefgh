// ملف app.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, deleteDoc, doc, query, where, enableIndexedDbPersistence, setDoc, getDoc, updateDoc, writeBatch } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { firebaseConfig, hashPass } from './config.js';

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

enableIndexedDbPersistence(db).catch((err) => { console.log(err.code); });

let currentCustomer = null;
let currentTransType = '';
let allCustomers = [];
let allInventory = [];
let editingCustId = null;
let editingInvId = null;
let cartItems = []; // سلة المشتريات الحالية

function initAnimations() {
    if(typeof gsap !== 'undefined') {
        gsap.utils.toArray('.gsap-btn').forEach(btn => {
            btn.addEventListener('mouseenter', () => gsap.to(btn, { scale: 1.05, duration: 0.2 }));
            btn.addEventListener('mouseleave', () => gsap.to(btn, { scale: 1, duration: 0.2 }));
        });
    }
}

// === إضافة مستمع لتنسيق المبلغ تلقائياً بالفواصل (نقاط) أثناء الكتابة ===
document.addEventListener('DOMContentLoaded', () => {
    const amountInput = document.getElementById('transAmount');
    if(amountInput) {
        amountInput.addEventListener('input', function(e) {
            let rawValue = this.value.replace(/[^0-9]/g, '');
            if (!rawValue) return;
            this.value = Number(rawValue).toLocaleString('de-DE');
        });
    }
    
    // البحث في المخزون عند الكتابة في حقل البيع
    const searchInv = document.getElementById('saleItemSearch');
    if(searchInv) {
        searchInv.addEventListener('input', function() {
            updateInventoryDatalist(this.value);
        });
    }

    // ربط زر الدخول بشكل مباشر لضمان عمله
    const loginBtn = document.getElementById('adminLoginBtn');
    if(loginBtn) {
        loginBtn.addEventListener('click', window.checkAdminLogin);
    }
});

// === التحقق من رمز المشرف (بدون تلميح) ===
function verifyAdminCode() {
    const code = prompt("أدخل رمز الإدارة:");
    if (code === '121') return true;
    alert("الرمز غير صحيح");
    return false;
}

window.checkAdminLogin = function() {
    const passInput = document.getElementById('adminPassInput').value;
    const storeInput = document.getElementById('storeNameInput').value;
    const storedPass = localStorage.getItem('admin_pass');
    
    if(storeInput) localStorage.setItem('store_name', storeInput);

    if (!storedPass) {
        if (passInput === '1234') {
            localStorage.setItem('admin_pass', hashPass('1234'));
            unlockApp();
        } else {
            alert("كلمة المرور الافتراضية لأول مرة هي: 1234");
        }
    } else {
        if (hashPass(passInput) === storedPass) unlockApp();
        else alert("كلمة المرور خاطئة");
    }
}

function unlockApp() {
    document.getElementById('lock-screen').style.display = 'none';
    document.getElementById('app').classList.remove('hidden');
    const storeName = localStorage.getItem('store_name');
    if(storeName) document.getElementById('headerStoreName').innerText = storeName;
    loadDashboard();
    loadInventory(); // تحميل المخزون
    loadSettings();
    initAnimations();
}

async function loadDashboard() {
    try {
        const custSnapshot = await getDocs(collection(db, "customers"));
        allCustomers = custSnapshot.docs.map(doc => ({ firebaseId: doc.id, ...doc.data() }));
        
        const transSnapshot = await getDocs(collection(db, "transactions"));
        const transactions = transSnapshot.docs.map(doc => ({ firebaseId: doc.id, ...doc.data() }));

        let totalDebt = 0;
        let totalPaidAll = 0; 
        const now = new Date();
        const overdueList = [];

        allCustomers.forEach(c => {
            c.balance = 0;
            const myTrans = transactions.filter(t => t.customerId === c.id);
            
            myTrans.forEach(t => {
                const amt = parseFloat(t.amount) || 0;
                if (t.type === 'debt' || t.type === 'sale') c.balance += amt;
                if (t.type === 'payment') c.balance -= amt;
            });
            
            if(myTrans.length > 0 && c.balance > 0) {
                myTrans.sort((a,b) => new Date(b.date) - new Date(a.date));
                c.lastDate = myTrans[0].date;
                const lastTransDate = new Date(c.lastDate);
                if(!isNaN(lastTransDate)) {
                    const diffTime = Math.abs(now - lastTransDate);
                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
                    const reminderDays = parseInt(c.reminderDays || 30);
                    if (diffDays >= reminderDays) {
                        c.isOverdue = true;
                        overdueList.push(c);
                    } else { c.isOverdue = false; }
                }
            } else { c.isOverdue = false; }
        });

        totalDebt = allCustomers.reduce((sum, c) => sum + c.balance, 0);

        transactions.forEach(t => {
            if (t.type === 'payment') {
                totalPaidAll += (parseFloat(t.amount) || 0);
            }
        });

        document.getElementById('totalDebt').innerText = formatCurrency(totalDebt, 'IQD');
        document.getElementById('totalPaidDisplay').innerText = formatCurrency(totalPaidAll, 'IQD');
        document.getElementById('customerCount').innerText = allCustomers.length;
        
        renderCustomersList(allCustomers);
        renderPaymentCustomersList(allCustomers);
        renderNotifications(overdueList);
    } catch (error) {
        console.error(error);
        if(navigator.onLine) alert("حدث خطأ في الاتصال: " + error.message);
    }
}

// === إدارة المخزون ===
async function loadInventory() {
    const snap = await getDocs(collection(db, "inventory"));
    allInventory = snap.docs.map(d => ({ firebaseId: d.id, ...d.data() }));
    renderInventoryList(allInventory);
}

window.filterInventory = function() {
    const q = document.getElementById('searchInventoryInput').value.toLowerCase();
    const filtered = allInventory.filter(i => i.name.toLowerCase().includes(q));
    renderInventoryList(filtered);
}

function renderInventoryList(list) {
    const container = document.getElementById('inventoryList');
    container.innerHTML = '';
    list.forEach(item => {
        const div = document.createElement('div');
        div.className = 'card glass flex flex-between';
        // إضافة حدث الضغط لعرض التفاصيل
        div.onclick = function() { viewInventoryItem(item.id); };
        div.style.cursor = 'pointer';

        div.innerHTML = `
            <div>
                <strong>${item.name}</strong><br>
                <small>بيع: ${formatCurrency(item.price, 'IQD')}</small>
            </div>
            <div style="text-align:left">
                <span class="badge-stock">العدد: ${item.qty}</span>
                <div class="mt-2">
                    <button class="btn btn-sm btn-warning" onclick="event.stopPropagation(); editInventoryItem('${item.id}')">✏️</button>
                    <button class="btn btn-sm btn-danger" onclick="event.stopPropagation(); deleteInventoryItem('${item.id}')">🗑️</button>
                </div>
            </div>
        `;
        container.appendChild(div);
    });
}

// دالة عرض تفاصيل السلعة والربح
window.viewInventoryItem = function(id) {
    const item = allInventory.find(i => i.id === id);
    if(!item) return;
    
    document.getElementById('viewInvName').innerText = item.name;
    document.getElementById('viewInvQty').innerText = item.qty;
    
    // البيانات الجديدة
    const sold = item.soldQty || 0;
    const buyPrice = parseFloat(item.purchasePrice) || 0;
    const sellPrice = parseFloat(item.price) || 0;
    
    // حساب الربح: (سعر البيع - سعر الشراء) * العدد المباع
    const profitPerUnit = sellPrice - buyPrice;
    const totalProfit = sold * profitPerUnit;

    document.getElementById('viewInvSold').innerText = sold;
    document.getElementById('viewInvBuy').innerText = formatCurrency(buyPrice, 'IQD');
    document.getElementById('viewInvSell').innerText = formatCurrency(sellPrice, 'IQD');
    
    document.getElementById('viewInvProfit').innerText = formatCurrency(totalProfit, 'IQD');
    
    window.showModal('modal-inventory-view');
}

window.openInventoryModal = function() {
    editingInvId = null;
    document.getElementById('invModalTitle').innerText = "سلعة جديدة";
    document.getElementById('invName').value = '';
    document.getElementById('invPurchasePrice').value = ''; // تفريغ سعر الشراء
    document.getElementById('invPrice').value = '';
    document.getElementById('invQty').value = '';
    window.showModal('modal-inventory-item');
}

window.saveInventoryItem = async function() {
    const name = document.getElementById('invName').value;
    const purchasePrice = parseFloat(document.getElementById('invPurchasePrice').value); // قراءة سعر الشراء
    const price = parseFloat(document.getElementById('invPrice').value);
    const qty = parseInt(document.getElementById('invQty').value);
    
    if(!name || isNaN(price) || isNaN(qty) || isNaN(purchasePrice)) return alert("أكمل جميع البيانات");

    try {
        if(editingInvId) {
            if(!verifyAdminCode()) return; // حماية التعديل
            const item = allInventory.find(i => i.id === editingInvId);
            await updateDoc(doc(db, "inventory", item.firebaseId), { name, purchasePrice, price, qty });
        } else {
            await addDoc(collection(db, "inventory"), {
                id: Date.now().toString(), name, purchasePrice, price, qty, soldQty: 0
            });
        }
        window.closeModal('modal-inventory-item');
        loadInventory();
    } catch(e) { alert("خطأ: " + e.message); }
}

window.editInventoryItem = function(id) {
    const item = allInventory.find(i => i.id === id);
    if(!item) return;
    editingInvId = id; // سيطلب الرمز عند الحفظ
    document.getElementById('invModalTitle').innerText = "تعديل سلعة";
    document.getElementById('invName').value = item.name;
    document.getElementById('invPurchasePrice').value = item.purchasePrice || ''; // عرض سعر الشراء
    document.getElementById('invPrice').value = item.price;
    document.getElementById('invQty').value = item.qty;
    window.showModal('modal-inventory-item');
}

window.deleteInventoryItem = async function(id) {
    if(!verifyAdminCode()) return; // حماية الحذف
    const item = allInventory.find(i => i.id === id);
    if(confirm(`حذف ${item.name}؟`)) {
        await deleteDoc(doc(db, "inventory", item.firebaseId));
        loadInventory();
    }
}

// === دوال البحث والزبائن ===
window.filterCustomers = function() {
    const query = document.getElementById('searchInput').value.toLowerCase();
    const filtered = allCustomers.filter(c => 
        c.name.toLowerCase().includes(query) || 
        (c.phone && c.phone.includes(query))
    );
    renderCustomersList(filtered);
}

function renderCustomersList(customers) {
    const list = document.getElementById('customersList');
    list.innerHTML = '';
    if(customers.length === 0) {
        list.innerHTML = '<p style="text-align:center">لا يوجد بيانات</p>';
        return;
    }
    customers.forEach(c => {
        const div = document.createElement('div');
        div.className = 'card glass flex flex-between';
        div.style.cursor = 'pointer';
        div.onclick = () => openCustomer(c.id);
        
        let alertIcon = c.isOverdue ? '⚠️' : '';
        let balanceColor = c.balance > 0 ? 'var(--danger)' : 'var(--accent)';

        div.innerHTML = `
            <div><strong>${c.name} ${alertIcon}</strong><br><small>${c.phone || ''}</small></div>
            <div style="text-align:left"><span style="font-weight:bold; color:${balanceColor}">${formatCurrency(c.balance, c.currency)}</span><br><small style="font-size:0.7em; color:#666">${c.lastDate || 'جديد'}</small></div>
        `;
        list.appendChild(div);
    });
}

window.filterPaymentCustomers = function() {
    const query = document.getElementById('searchPaymentCustInput').value.toLowerCase();
    const filtered = allCustomers.filter(c => 
        c.name.toLowerCase().startsWith(query)
    );
    renderPaymentCustomersList(filtered);
}

function renderPaymentCustomersList(customers) {
    const list = document.getElementById('paymentCustomersList');
    list.innerHTML = '';
    if(customers.length === 0) {
        list.innerHTML = '<p style="text-align:center">لا يوجد بيانات</p>';
        return;
    }
    customers.forEach(c => {
        const div = document.createElement('div');
        div.className = 'card glass flex flex-between';
        div.style.cursor = 'pointer';
        div.onclick = () => openPaymentCustomer(c.id);
        
        let balanceColor = c.balance > 0 ? 'var(--danger)' : 'var(--accent)';

        div.innerHTML = `
            <div><strong>${c.name}</strong><br><small>${c.phone || ''}</small></div>
            <div style="text-align:left"><span style="font-weight:bold; color:${balanceColor}">${formatCurrency(c.balance, c.currency)}</span></div>
        `;
        list.appendChild(div);
    });
}

function renderNotifications(list) {
    const container = document.getElementById('alertsList');
    const badge = document.getElementById('badge-alert');
    if(!container || !badge) return;
    container.innerHTML = '';
    
    if(list.length > 0) {
        badge.classList.remove('hidden');
        badge.innerText = list.length;
        list.forEach(c => {
            const div = document.createElement('div');
            div.className = 'card glass';
            div.style.borderRight = '5px solid orange';
            div.innerHTML = `
                <div class="flex flex-between"><strong>⚠️ ${c.name}</strong><span>${formatCurrency(c.balance, c.currency)}</span></div>
                <small>تجاوز ${c.reminderDays || 30} يوم</small><br>
                <button class="btn btn-sm btn-primary mt-2" onclick="openCustomer('${c.id}')">مراجعة</button>
            `;
            container.appendChild(div);
        });
    } else {
        badge.classList.add('hidden');
        container.innerHTML = '<p class="text-center">لا توجد تنبيهات ✅</p>';
    }
}

window.openAddModal = function() {
    editingCustId = null;
    document.getElementById('modalCustTitle').innerText = "زبون جديد";
    document.getElementById('newCustName').value = '';
    document.getElementById('newCustPhone').value = '';
    document.getElementById('newCustPass').value = '';
    window.showModal('modal-add-customer');
}

window.saveCustomer = async function() {
    const name = document.getElementById('newCustName').value;
    const phone = document.getElementById('newCustPhone').value;
    const currency = document.getElementById('newCustCurrency').value;
    const reminderDays = document.getElementById('newCustReminder').value;
    let pass = document.getElementById('newCustPass').value;
    
    if(!name) return alert('الاسم مطلوب');

    // إذا كان تعديل، نطلب الرمز
    if (editingCustId && !verifyAdminCode()) return;

    if (!pass) {
        do {
            pass = Math.floor(100 + Math.random() * 900).toString();
        } while (allCustomers.some(c => c.password === pass && c.id !== editingCustId));
    } else {
        const exists = allCustomers.some(c => c.password === pass && c.id !== editingCustId);
        if (exists) return alert("هذا الرمز مستخدم بالفعل لزبون آخر! اختر رمزاً آخر.");
    }

    try {
        if (editingCustId) {
            const customerRef = allCustomers.find(c => c.id === editingCustId);
            updateDoc(doc(db, "customers", customerRef.firebaseId), {
                name, phone, currency, reminderDays, password: pass
            });
            alert("تم تعديل بيانات الزبون");
        } else {
            const id = Date.now().toString();
            addDoc(collection(db, "customers"), {
                id, name, phone, currency, 
                reminderDays: reminderDays || 30,
                password: pass,
                created: new Date().toISOString()
            });
        }
        
        window.closeModal('modal-add-customer');
        loadDashboard();
        if(editingCustId) goHome();
    } catch (e) { alert("خطأ: " + e.message); }
}

window.openCustomer = async function(id) {
    const customer = allCustomers.find(c => c.id == id);
    if (!customer) return;
    currentCustomer = customer;
    
    const q = query(collection(db, "transactions"), where("customerId", "==", id));
    const snap = await getDocs(q);
    const trans = snap.docs.map(d => ({firebaseId: d.id, ...d.data()}));
    trans.sort((a,b) => new Date(b.date) - new Date(a.date));

    let realTimeBalance = 0;
    trans.forEach(t => {
        const amt = parseFloat(t.amount) || 0;
        if (t.type === 'debt' || t.type === 'sale') realTimeBalance += amt;
        if (t.type === 'payment') realTimeBalance -= amt;
    });

    document.getElementById('view-customer').classList.remove('hidden');
    document.getElementById('custName').innerText = customer.name;
    document.getElementById('custPhone').innerText = customer.phone || '';
    
    document.getElementById('custBalance').innerText = formatCurrency(realTimeBalance, customer.currency);
    
    document.getElementById('custPasswordDisplay').innerText = customer.password || '---';

    const mainTrans = trans.filter(t => t.type !== 'payment');
    renderTransactions(mainTrans, customer.currency);
}

window.openPaymentCustomer = async function(id) {
    const customer = allCustomers.find(c => c.id == id);
    if (!customer) return;
    currentCustomer = customer;
    
    const q = query(collection(db, "transactions"), where("customerId", "==", id));
    const snap = await getDocs(q);
    const trans = snap.docs.map(d => ({firebaseId: d.id, ...d.data()}));
    trans.sort((a,b) => new Date(b.date) - new Date(a.date));

    let realTimeBalance = 0;
    const paymentTrans = [];
    trans.forEach(t => {
        const amt = parseFloat(t.amount) || 0;
        if (t.type === 'debt' || t.type === 'sale') realTimeBalance += amt;
        if (t.type === 'payment') {
            realTimeBalance -= amt;
            paymentTrans.push(t);
        }
    });

    document.getElementById('view-payment-customer').classList.remove('hidden');
    document.getElementById('payCustName').innerText = customer.name;
    document.getElementById('payCustBalance').innerText = formatCurrency(realTimeBalance, customer.currency);

    renderPaymentTransactions(paymentTrans, customer.currency);
}

window.closePaymentCustomerView = function() {
    document.getElementById('view-payment-customer').classList.add('hidden');
    loadDashboard();
}

window.deleteCustomer = async function() {
    if (!currentCustomer) return;
    
    if(!verifyAdminCode()) return; // حماية الحذف

    if (!confirm(`هل أنت متأكد من حذف الزبون "${currentCustomer.name}" وجميع ديونه؟ لا يمكن التراجع!`)) return;

    try {
        await deleteDoc(doc(db, "customers", currentCustomer.firebaseId));
        const q = query(collection(db, "transactions"), where("customerId", "==", currentCustomer.id));
        const snap = await getDocs(q);
        snap.forEach(async (d) => {
            await deleteDoc(doc(db, "transactions", d.id));
        });

        alert("تم الحذف بنجاح");
        goHome();
    } catch(e) { alert("خطأ في الحذف: " + e.message); }
}

window.editCustomer = function() {
    if (!currentCustomer) return;
    // الحماية ستكون عند الضغط على "حفظ" في saveCustomer
    editingCustId = currentCustomer.id;
    
    document.getElementById('modalCustTitle').innerText = "تعديل بيانات الزبون";
    document.getElementById('newCustName').value = currentCustomer.name;
    document.getElementById('newCustPhone').value = currentCustomer.phone;
    document.getElementById('newCustCurrency').value = currentCustomer.currency;
    document.getElementById('newCustReminder').value = currentCustomer.reminderDays;
    document.getElementById('newCustPass').value = currentCustomer.password;
    
    window.showModal('modal-add-customer');
}

window.downloadBackup = async function() {
    if(!confirm("تحميل نسخة احتياطية من كل البيانات؟")) return;
    try {
        const custSnap = await getDocs(collection(db, "customers"));
        const transSnap = await getDocs(collection(db, "transactions"));
        const invSnap = await getDocs(collection(db, "inventory")); // backup inventory
        const backupData = {
            date: new Date().toISOString(),
            customers: custSnap.docs.map(d => d.data()),
            transactions: transSnap.docs.map(d => d.data()),
            inventory: invSnap.docs.map(d => d.data())
        };
        const blob = new Blob([JSON.stringify(backupData)], {type: "application/json"});
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `backup_${new Date().toISOString().split('T')[0]}.json`;
        a.click();
    } catch(e) { alert("خطأ: " + e.message); }
}

window.restoreBackup = function(input) {
    const file = input.files[0];
    if(!file) return;
    if(!confirm("استعادة النسخة سيضيف البيانات الحالية. متأكد؟")) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = JSON.parse(e.target.result);
            if(data.customers) for(const c of data.customers) await addDoc(collection(db, "customers"), c);
            if(data.transactions) for(const t of data.transactions) await addDoc(collection(db, "transactions"), t);
            if(data.inventory) for(const i of data.inventory) await addDoc(collection(db, "inventory"), i);
            alert("تمت الاستعادة!");
            location.reload();
        } catch(err) { alert("ملف غير صالح"); }
    };
    reader.readAsText(file);
}

window.saveStoreSettings = async function() {
    let wa = document.getElementById('storeWhatsapp').value;
    if(!wa) return;
    wa = wa.replace(/[^0-9]/g, '');
    if(wa.startsWith('0')) {
        wa = '964' + wa.substring(1);
    }
    await setDoc(doc(db, "settings", "info"), { whatsapp: wa }, { merge: true });
    alert("تم حفظ الواتساب");
}

async function loadSettings() {
    const s = await getDoc(doc(db, "settings", "info"));
    if(s.exists()) document.getElementById('storeWhatsapp').value = s.data().whatsapp || '';
}

window.changeAdminPassReal = function() {
    const old = document.getElementById('oldPass').value;
    const newP = document.getElementById('newPass').value;
    const confP = document.getElementById('confirmPass').value;
    if(hashPass(old) !== localStorage.getItem('admin_pass')) return alert("الكلمة الحالية خطأ");
    if(newP !== confP) return alert("كلمة المرور غير متطابقة");
    localStorage.setItem('admin_pass', hashPass(newP));
    location.reload();
}

window.formatCurrency = (n, c) => {
    const formatted = Number(n).toLocaleString('de-DE', {minimumFractionDigits: 0, maximumFractionDigits: 2});
    return c === 'USD' ? `$${formatted}` : `${formatted} د.ع`;
};

window.showModal = (id) => document.getElementById(id).classList.remove('hidden');
window.closeModal = (id) => document.getElementById(id).classList.add('hidden');
window.goHome = () => { document.getElementById('view-customer').classList.add('hidden'); loadDashboard(); };
window.switchTab = (id, btn) => {
    document.querySelectorAll('.tab-content').forEach(d => d.classList.add('hidden'));
    document.getElementById(id).classList.remove('hidden');
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
}

// === منطق المعاملات والسلة والبيع ===
window.openTransModal = function(type) {
    currentTransType = type;
    const title = type === 'debt' ? 'إضافة دين' : (type === 'payment' ? 'تسديد' : 'بيع');
    document.getElementById('transTitle').innerText = title;
    document.getElementById('transDate').valueAsDate = new Date();
    document.getElementById('transAmount').value = '';
    document.getElementById('transNote').value = '';
    
    // إعداد واجهة البيع (المخزون)
    const saleSection = document.getElementById('saleSection');
    const amtInput = document.getElementById('transAmount');
    
    if(type === 'sale') {
        saleSection.classList.remove('hidden');
        amtInput.disabled = true; // سيتم حسابه تلقائياً
        amtInput.placeholder = "المجموع تلقائي";
        cartItems = [];
        renderCart();
    } else {
        saleSection.classList.add('hidden');
        amtInput.disabled = false;
        amtInput.placeholder = "المبلغ (مثال: 10.000)";
    }
    
    window.showModal('modal-transaction');
}

// دالة لتحديث القائمة المنسدلة عند الكتابة (أول حرف)
window.updateInventoryDatalist = function(txt) {
    const datalist = document.getElementById('inventoryDatalist');
    datalist.innerHTML = '';
    if(!txt) return;
    
    const matches = allInventory.filter(i => i.name.toLowerCase().startsWith(txt.toLowerCase()));
    matches.forEach(item => {
        const option = document.createElement('option');
        option.value = item.name; // سيتم استخدام الاسم للبحث عن الكائن لاحقاً
        datalist.appendChild(option);
    });
}

// إضافة للسلة
window.addItemToCart = function() {
    const nameInput = document.getElementById('saleItemSearch');
    const qtyInput = document.getElementById('saleItemQty');
    
    const name = nameInput.value;
    const qty = parseInt(qtyInput.value);
    
    const itemRef = allInventory.find(i => i.name === name);
    
    if(!itemRef) return alert("السلعة غير موجودة بالمخزون");
    if(qty > itemRef.qty) return alert(`الكمية غير متوفرة! المتاح: ${itemRef.qty}`);
    if(qty <= 0) return alert("الكمية يجب أن تكون 1 أو أكثر");

    // إضافة للسلة
    cartItems.push({
        id: itemRef.id,
        firebaseId: itemRef.firebaseId,
        name: itemRef.name,
        price: itemRef.price,
        qty: qty,
        total: itemRef.price * qty
    });

    // تفريغ الحقول
    nameInput.value = '';
    qtyInput.value = 1;
    renderCart();
}

function renderCart() {
    const div = document.getElementById('saleCart');
    div.innerHTML = '';
    let grandTotal = 0;
    
    cartItems.forEach((c, idx) => {
        grandTotal += c.total;
        const row = document.createElement('div');
        row.className = "flex flex-between";
        row.style.fontSize = "0.9em";
        row.style.borderBottom = "1px solid #eee";
        row.innerHTML = `
            <span>${c.name} (x${c.qty})</span>
            <span>${c.total} <button class="btn btn-sm btn-danger" onclick="removeFromCart(${idx})" style="padding:0 5px; margin-right:5px;">x</button></span>
        `;
        div.appendChild(row);
    });
    
    document.getElementById('cartTotalDisplay').innerText = formatCurrency(grandTotal, 'IQD');
    // تحديث حقل المبلغ تلقائياً
    const amtInput = document.getElementById('transAmount');
    amtInput.value = grandTotal.toLocaleString('de-DE'); // للعرض
}

window.removeFromCart = function(idx) {
    cartItems.splice(idx, 1);
    renderCart();
}

window.saveTransaction = async function() {
    let rawAmount = document.getElementById('transAmount').value;
    rawAmount = rawAmount.replace(/\./g, '').replace(/,/g, '');
    const amount = parseFloat(rawAmount);
    
    const note = document.getElementById('transNote').value;
    const date = document.getElementById('transDate').value;
    
    if(!amount && currentTransType !== 'sale') return alert("أدخل المبلغ");
    if(currentTransType === 'sale' && cartItems.length === 0 && !amount) return alert("أضف مواد للسلة أو أدخل مبلغاً");

    // تجهيز نص المواد للفاتورة
    let itemsDescription = currentTransType === 'sale' ? cartItems.map(c => `${c.name} x${c.qty}`).join(', ') : '';
    if(note) itemsDescription += (itemsDescription ? ' | ' : '') + note;

    try {
        // إذا كان بيع وفيه مواد مخزنية، نقوم بإنقاص الكمية وزيادة عدد المبيعات
        if(currentTransType === 'sale' && cartItems.length > 0) {
            const batch = writeBatch(db);
            // إنقاص المخزون وزيادة المباع
            for (const c of cartItems) {
                const itemRef = doc(db, "inventory", c.firebaseId);
                const currentInv = allInventory.find(i => i.id === c.id);
                
                const newQty = (parseInt(currentInv.qty) - parseInt(c.qty));
                const currentSold = parseInt(currentInv.soldQty || 0);
                const newSold = currentSold + parseInt(c.qty);
                
                batch.update(itemRef, { qty: newQty, soldQty: newSold });
            }
            // إضافة المعاملة
            const transRef = doc(collection(db, "transactions"));
            batch.set(transRef, {
                customerId: currentCustomer.id,
                type: currentTransType,
                amount,
                note: itemsDescription, // خزن تفاصيل المواد هنا
                item: itemsDescription || "فاتورة مخزنية", // ✅ تم التعديل: استخدام وصف المواد كعنوان
                date,
                timestamp: new Date().toISOString()
            });
            
            await batch.commit();
            loadInventory(); // تحديث الواجهة

        } else {
            // عملية عادية (دين أو تسديد أو بيع يدوي بدون مخزون)
            await addDoc(collection(db, "transactions"), {
                customerId: currentCustomer.id,
                type: currentTransType,
                amount, note: itemsDescription, 
                item: itemsDescription || (currentTransType === 'sale' ? 'بيع مباشر' : ''), // ✅ تم التعديل: استخدام الوصف كعنوان
                date,
                timestamp: new Date().toISOString()
            });
        }

        closeModal('modal-transaction');
        openCustomer(currentCustomer.id);
        loadDashboard();
    } catch(e) { alert("خطأ: " + e.message); }
}

// عرض المعاملات مع أزرار التعديل والحذف
function renderTransactions(transactions, currency) {
    const list = document.getElementById('transactionsList');
    list.innerHTML = '';
    transactions.forEach(t => {
        const div = document.createElement('div');
        div.className = 'trans-item flex flex-between';
        let colorClass = (t.type === 'payment') ? 'trans-pay' : 'trans-debt';
        let typeName = t.type === 'debt' ? 'دين' : (t.type === 'payment' ? 'تسديد' : 'فاتورة');
        
        div.innerHTML = `
            <div>
                <strong class="${colorClass}">${typeName}</strong> <small>${t.item || t.note || ''}</small><br>
                <small>${t.date}</small>
            </div>
            <div style="text-align:left">
                <strong class="${colorClass}">${window.formatCurrency(t.amount, currency)}</strong>
                <div class="mt-2">
                    <button class="btn btn-sm btn-warning" onclick="editTransaction('${t.firebaseId}', ${t.amount})" style="padding:2px 8px; font-size:0.7rem;">✏️</button>
                    <button class="btn btn-sm btn-danger" onclick="deleteTransaction('${t.firebaseId}')" style="padding:2px 8px; font-size:0.7rem;">🗑️</button>
                </div>
            </div>
        `;
        list.appendChild(div);
    });
}

function renderPaymentTransactions(transactions, currency) {
    const list = document.getElementById('paymentTransactionsList');
    list.innerHTML = '';
    transactions.forEach(t => {
        const div = document.createElement('div');
        div.className = 'trans-item flex flex-between';
        
        div.innerHTML = `
            <div>
                <strong class="trans-pay">تسديد</strong> <small>${t.item || t.note || ''}</small><br>
                <small>${t.date}</small>
            </div>
            <div style="text-align:left">
                <strong class="trans-pay">${window.formatCurrency(t.amount, currency)}</strong>
                <div class="mt-2">
                    <button class="btn btn-sm btn-warning" onclick="editTransaction('${t.firebaseId}', ${t.amount})" style="padding:2px 8px; font-size:0.7rem;">✏️</button>
                    <button class="btn btn-sm btn-danger" onclick="deleteTransaction('${t.firebaseId}')" style="padding:2px 8px; font-size:0.7rem;">🗑️</button>
                </div>
            </div>
        `;
        list.appendChild(div);
    });
}

// === حذف وتعديل العمليات (مع حماية 121) ===
window.deleteTransaction = async function(firebaseId) {
    if(!verifyAdminCode()) return; // طلب الكود

    if(confirm("هل أنت متأكد من حذف هذه العملية؟")) {
        try {
            await deleteDoc(doc(db, "transactions", firebaseId));
            if(!document.getElementById('view-payment-customer').classList.contains('hidden')) {
                openPaymentCustomer(currentCustomer.id);
            } else {
                openCustomer(currentCustomer.id);
            }
            loadDashboard();
        } catch(e) { alert("خطأ: " + e.message); }
    }
}

window.editTransaction = async function(firebaseId, oldAmount) {
    if(!verifyAdminCode()) return; // طلب الكود

    // تعديل بسيط للمبلغ والتاريخ والملاحظة
    const newAmountRaw = prompt("أدخل المبلغ الجديد:", oldAmount);
    if(newAmountRaw === null) return;
    
    // تنظيف الرقم
    let cleanAmt = newAmountRaw.toString().replace(/\./g, '').replace(/,/g, '');
    const newAmount = parseFloat(cleanAmt);
    
    if(isNaN(newAmount)) return alert("رقم غير صالح");

    const newNote = prompt("تعديل الملاحظة (اختياري):");

    try {
        const updateData = { amount: newAmount };
        if(newNote) updateData.note = newNote;
        
        await updateDoc(doc(db, "transactions", firebaseId), updateData);
        alert("تم التعديل");
        if(!document.getElementById('view-payment-customer').classList.contains('hidden')) {
            openPaymentCustomer(currentCustomer.id);
        } else {
            openCustomer(currentCustomer.id);
        }
        loadDashboard();
    } catch(e) { alert("خطأ: " + e.message); }
}

window.logout = function() { location.reload(); }
if(localStorage.getItem('admin_pass')) { /* Locked */ }
