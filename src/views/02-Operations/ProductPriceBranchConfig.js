import React, { useEffect, useMemo, useState } from 'react';
import {
  getProducts,
  saveProduct,
  getBranchPrices,
  saveBranchPrice,
  getBranchStockConfig,
  saveBranchStockConfig,
  postOpeningBalances,
  getCogsReadiness,
  activateCogs,
} from '../../api/inventoryService';
import { getPlants } from '../../api/operationsService';
import { glFinanceConfidence } from '../../api/glService';

const today = () => new Date().toISOString().slice(0, 10);
const money = (n) => `₦${Number(n || 0).toLocaleString()}`;

export default function ProductPriceBranchConfig() {
  const [plants, setPlants] = useState([]);
  const [branchId, setBranchId] = useState('');
  const [products, setProducts] = useState([]);
  const [prices, setPrices] = useState([]);
  const [stockConfigs, setStockConfigs] = useState([]);
  const [cogs, setCogs] = useState(null);
  const [confidence, setConfidence] = useState(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const [productForm, setProductForm] = useState({ sku: 'BULK-LPG-KG', name: 'Bulk LPG Per KG', productType: 'BULK_LPG', unitOfMeasure: 'KG', defaultKg: 1, defaultSellingPrice: 0 });
  const [priceForm, setPriceForm] = useState({ productId: 'BULK-LPG-KG', pricePerKg: '', effectiveStartDate: today(), notes: '' });
  const [mappingForm, setMappingForm] = useState({ stockLocationId: '', stockLocationName: '', defaultProductSku: 'BULK-LPG-KG', serviceZoneIds: '' });
  const [openingForm, setOpeningForm] = useState({ businessDate: today(), cashOnHand: 0, bankTransfers: 0, bankPOS: 0, inventoryValue: 0, accountsReceivable: 0, accountsPayable: 0, notes: '' });

  const selectedPlant = useMemo(() => plants.find((p) => String(p._id || p.id) === String(branchId)), [plants, branchId]);

  const loadAll = async () => {
    setLoading(true);
    setMessage('');
    try {
      const plantRows = await getPlants();
      const p = Array.isArray(plantRows) ? plantRows : (plantRows.items || plantRows.plants || []);
      setPlants(p);
      const activeBranch = branchId || String(p?.[0]?._id || p?.[0]?.id || '');
      if (!branchId && activeBranch) setBranchId(activeBranch);
      const [prodRes, priceRes, mapRes, cogsRes, confRes] = await Promise.all([
        getProducts(),
        activeBranch ? getBranchPrices({ branchId: activeBranch }) : Promise.resolve({ items: [] }),
        activeBranch ? getBranchStockConfig({ branchId: activeBranch }) : Promise.resolve({ items: [] }),
        activeBranch ? getCogsReadiness({ branchId: activeBranch }) : Promise.resolve(null),
        activeBranch ? glFinanceConfidence({ startDate: today(), endDate: today(), branchIdOrZoneId: activeBranch }) : Promise.resolve(null),
      ]);
      setProducts(prodRes.items || []);
      setPrices(priceRes.items || []);
      setStockConfigs(mapRes.items || []);
      setCogs(cogsRes);
      setConfidence(confRes);
      if (activeBranch && !mappingForm.stockLocationId) {
        setMappingForm((f) => ({ ...f, stockLocationId: activeBranch, stockLocationName: selectedPlant?.name || '' }));
      }
    } catch (e) {
      setMessage(e.message || 'Failed to load configuration.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAll(); /* eslint-disable-next-line */ }, [branchId]);

  const handleSaveProduct = async () => {
    setMessage('');
    try {
      await saveProduct(productForm);
      setMessage('Product saved.');
      await loadAll();
    } catch (e) { setMessage(e.message); }
  };

  const handleSavePrice = async () => {
    setMessage('');
    try {
      await saveBranchPrice({ ...priceForm, branchId });
      setMessage('Branch price saved.');
      await loadAll();
    } catch (e) { setMessage(e.message); }
  };

  const handleSaveMapping = async () => {
    setMessage('');
    try {
      await saveBranchStockConfig({ ...mappingForm, branchId, serviceZoneIds: String(mappingForm.serviceZoneIds || '').split(',').map((x) => x.trim()).filter(Boolean) });
      setMessage('Branch stock mapping saved.');
      await loadAll();
    } catch (e) { setMessage(e.message); }
  };

  const handleOpeningBalance = async () => {
    setMessage('');
    try {
      await postOpeningBalances({ ...openingForm, branchId });
      setMessage('Opening balances posted to GL.');
      await loadAll();
    } catch (e) { setMessage(e.message); }
  };

  const handleActivateCogs = async () => {
    setMessage('');
    try {
      await activateCogs({ branchId, note: 'Activated from Product/Price/Branch Configuration screen' });
      setMessage('COGS activated for branch.');
      await loadAll();
    } catch (e) { setMessage(e.message); }
  };

  const input = 'w-full bg-slate-900/80 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white';
  const button = 'px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold disabled:opacity-50';
  const card = 'bg-slate-900/70 border border-slate-700 rounded-2xl p-5 shadow-xl';

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Product, Price & Branch Configuration</h1>
          <p className="text-slate-400 text-sm mt-1">Configure LPG products, effective branch prices, plant-to-stock mapping, opening balances and COGS activation.</p>
        </div>
        <div className="flex gap-3 items-center">
          <select className={input} value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            <option value="">Select branch / plant</option>
            {plants.map((p) => <option key={p._id || p.id} value={p._id || p.id}>{p.name || p.id}</option>)}
          </select>
          <button className={button} onClick={loadAll} disabled={loading}>{loading ? 'Loading...' : 'Refresh'}</button>
        </div>
      </div>

      {message && <div className="bg-blue-500/10 border border-blue-400/30 text-blue-100 rounded-xl p-3 text-sm">{message}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className={card}>
          <div className="text-slate-400 text-xs uppercase">Finance Confidence</div>
          <div className="text-4xl font-bold mt-2">{confidence?.score ?? '--'}%</div>
          <div className="text-sm text-slate-300 mt-1">{confidence?.level || 'Not calculated'}</div>
          <div className="mt-3 space-y-1 text-xs text-slate-400">
            {(confidence?.checks || []).slice(0, 5).map((c) => <div key={c.key}>{c.passed ? '✓' : '⚠'} {c.message}</div>)}
          </div>
        </div>
        <div className={card}>
          <div className="text-slate-400 text-xs uppercase">COGS Readiness</div>
          <div className="text-2xl font-bold mt-2">{cogs?.ready ? 'Ready' : 'Not Ready'}</div>
          <div className="text-sm text-slate-300 mt-1">WAC: {money(cogs?.wac)} / kg · Stock: {Number(cogs?.remainingKg || 0).toLocaleString()}kg</div>
          <button className={`${button} mt-4`} disabled={!branchId} onClick={handleActivateCogs}>Activate COGS</button>
        </div>
        <div className={card}>
          <div className="text-slate-400 text-xs uppercase">Branch Mapping</div>
          <div className="text-2xl font-bold mt-2">{stockConfigs?.[0]?.stockLocationName || selectedPlant?.name || 'Not mapped'}</div>
          <div className="text-sm text-slate-300 mt-1">Stock Location: {stockConfigs?.[0]?.stockLocationId || 'Missing'}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className={card}>
          <h2 className="font-semibold text-white mb-4">1. LPG Product Setup</h2>
          <div className="grid grid-cols-2 gap-3">
            <input className={input} placeholder="SKU" value={productForm.sku} onChange={(e) => setProductForm({ ...productForm, sku: e.target.value })} />
            <input className={input} placeholder="Product name" value={productForm.name} onChange={(e) => setProductForm({ ...productForm, name: e.target.value })} />
            <input className={input} placeholder="Default KG" value={productForm.defaultKg} onChange={(e) => setProductForm({ ...productForm, defaultKg: e.target.value })} />
            <input className={input} placeholder="Default selling price" value={productForm.defaultSellingPrice} onChange={(e) => setProductForm({ ...productForm, defaultSellingPrice: e.target.value })} />
          </div>
          <button className={`${button} mt-4`} onClick={handleSaveProduct}>Save Product</button>
          <div className="mt-4 max-h-48 overflow-auto text-sm">
            {products.map((p) => <div key={p.id || p._id} className="flex justify-between border-b border-slate-800 py-2"><span>{p.sku} — {p.name}</span><span>{money(p.defaultSellingPrice)}</span></div>)}
          </div>
        </div>

        <div className={card}>
          <h2 className="font-semibold text-white mb-4">2. Branch Effective Pricing</h2>
          <div className="grid grid-cols-2 gap-3">
            <select className={input} value={priceForm.productId} onChange={(e) => setPriceForm({ ...priceForm, productId: e.target.value })}>
              <option value="BULK-LPG-KG">Bulk LPG KG</option>
              {products.map((p) => <option key={p.id || p._id} value={p.id || p.sku}>{p.sku} — {p.name}</option>)}
            </select>
            <input className={input} placeholder="Price per kg" value={priceForm.pricePerKg} onChange={(e) => setPriceForm({ ...priceForm, pricePerKg: e.target.value })} />
            <input className={input} type="date" value={priceForm.effectiveStartDate} onChange={(e) => setPriceForm({ ...priceForm, effectiveStartDate: e.target.value })} />
            <input className={input} placeholder="Notes" value={priceForm.notes} onChange={(e) => setPriceForm({ ...priceForm, notes: e.target.value })} />
          </div>
          <button className={`${button} mt-4`} disabled={!branchId} onClick={handleSavePrice}>Save Branch Price</button>
          <div className="mt-4 max-h-48 overflow-auto text-sm">
            {prices.map((p) => <div key={p.id || p._id} className="flex justify-between border-b border-slate-800 py-2"><span>{p.productSku || p.productId} · {new Date(p.effectiveStartDate).toLocaleDateString()}</span><span>{money(p.pricePerKg)}/kg</span></div>)}
          </div>
        </div>

        <div className={card}>
          <h2 className="font-semibold text-white mb-4">3. Plant-to-Stock Mapping</h2>
          <div className="grid grid-cols-2 gap-3">
            <input className={input} placeholder="Stock location ID" value={mappingForm.stockLocationId || branchId} onChange={(e) => setMappingForm({ ...mappingForm, stockLocationId: e.target.value })} />
            <input className={input} placeholder="Stock location name" value={mappingForm.stockLocationName} onChange={(e) => setMappingForm({ ...mappingForm, stockLocationName: e.target.value })} />
            <input className={`${input} col-span-2`} placeholder="Service zone IDs, comma-separated" value={mappingForm.serviceZoneIds} onChange={(e) => setMappingForm({ ...mappingForm, serviceZoneIds: e.target.value })} />
          </div>
          <button className={`${button} mt-4`} disabled={!branchId} onClick={handleSaveMapping}>Save Mapping</button>
        </div>

        <div className={card}>
          <h2 className="font-semibold text-white mb-4">4. Opening Balance Wizard</h2>
          <div className="grid grid-cols-2 gap-3">
            <input className={input} type="date" value={openingForm.businessDate} onChange={(e) => setOpeningForm({ ...openingForm, businessDate: e.target.value })} />
            <input className={input} placeholder="Cash on hand" value={openingForm.cashOnHand} onChange={(e) => setOpeningForm({ ...openingForm, cashOnHand: e.target.value })} />
            <input className={input} placeholder="Bank transfer balance" value={openingForm.bankTransfers} onChange={(e) => setOpeningForm({ ...openingForm, bankTransfers: e.target.value })} />
            <input className={input} placeholder="POS settlement balance" value={openingForm.bankPOS} onChange={(e) => setOpeningForm({ ...openingForm, bankPOS: e.target.value })} />
            <input className={input} placeholder="Inventory value" value={openingForm.inventoryValue} onChange={(e) => setOpeningForm({ ...openingForm, inventoryValue: e.target.value })} />
            <input className={input} placeholder="Payables" value={openingForm.accountsPayable} onChange={(e) => setOpeningForm({ ...openingForm, accountsPayable: e.target.value })} />
          </div>
          <button className={`${button} mt-4`} disabled={!branchId} onClick={handleOpeningBalance}>Post Opening Balances</button>
        </div>
      </div>
    </div>
  );
}
