import React from 'react';
import { Wallet, ArrowUpRight, Shield, RefreshCw } from 'lucide-react';

export default function SepoliaWalletModal() {
  return (
    <div className="min-h-screen bg-black text-white p-8 pl-28">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-emerald-400">Sepolia Wallet & Testnet</h1>
          <button className="bg-emerald-600 hover:bg-emerald-500 px-5 py-2.5 rounded-xl font-medium flex items-center gap-2 transition">
            <RefreshCw size={16} /> Sync Balance
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-neutral-900 border border-neutral-800 p-6 rounded-3xl">
            <p className="text-gray-400 text-sm mb-1">Total Testnet Balance</p>
            <h3 className="text-4xl font-extrabold text-white mb-4">4.8500 <span className="text-emerald-400 text-xl">ETH</span></h3>
            <p className="text-xs text-gray-500">Connected via MetaMask to Sepolia Test Network.</p>
          </div>

          <div className="bg-neutral-900 border border-neutral-800 p-6 rounded-3xl flex flex-col justify-between">
            <div>
              <h4 className="font-semibold text-lg mb-2">Smart Contract Security</h4>
              <p className="text-xs text-gray-400">Transactions are guarded by automated AI risk control rails.</p>
            </div>
            <div className="flex items-center gap-2 text-emerald-400 text-sm font-medium mt-4">
              <Shield size={18} /> Fully Protected
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}