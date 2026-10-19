import React from 'react';
import { Search, User, Wallet, ShieldCheck, Cpu } from 'lucide-react';

export default function Home() {
  return (
    <div className="min-h-screen bg-black text-white pl-28 pr-6 py-6 font-sans">
      {/* Top Header Bar */}
      <div className="flex justify-between items-center mb-8">
        <div className="relative w-96">
          <Search className="absolute left-4 top-3.5 text-gray-400" size={18} />
          <input
            type="text"
            placeholder="Search..."
            className="w-full bg-neutral-900 border border-neutral-800 rounded-full py-3 pl-12 pr-4 text-sm text-white focus:outline-none focus:border-emerald-500"
          />
        </div>
        <div className="flex items-center gap-4">
          <button className="w-12 h-12 bg-white text-black rounded-full flex items-center justify-center hover:bg-emerald-400 transition">
            <User size={20} />
          </button>
          <button className="w-12 h-12 bg-white text-black rounded-full flex items-center justify-center hover:bg-emerald-400 transition">
            <Wallet size={20} />
          </button>
        </div>
      </div>

      {/* Main Dashboard Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Hero Card */}
        <div className="lg:col-span-2 bg-gradient-to-br from-emerald-950 via-neutral-900 to-black rounded-3xl p-8 relative overflow-hidden border border-emerald-500/20 flex flex-col justify-between h-[420px]">
          <div>
            <h1 className="text-4xl lg:text-5xl font-extrabold tracking-tight mb-3">
              Smart <span className="text-emerald-400">Finance</span> <br />
              For Modern User
            </h1>
          </div>
          
          {/* Card Graphic Simulation */}
          <div className="absolute right-6 bottom-6 w-80 h-48 bg-gradient-to-tr from-neutral-900 to-neutral-800 rounded-2xl p-5 border border-neutral-700 shadow-2xl transform rotate-3 hover:rotate-0 transition duration-300">
            <div className="flex justify-between items-center mb-12">
              <div className="w-10 h-8 bg-amber-200/80 rounded-md"></div>
              <span className="text-xs tracking-widest text-gray-400 font-bold">mastercard.</span>
            </div>
            <div className="flex justify-between items-end">
              <div>
                <p className="text-xs text-gray-400">Balance</p>
                <p className="text-lg font-bold text-white">$24,580.00</p>
              </div>
              <div className="flex -space-x-2">
                <div className="w-6 h-6 rounded-full bg-red-500 opacity-80"></div>
                <div className="w-6 h-6 rounded-full bg-amber-500 opacity-80"></div>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 z-10">
            <div className="bg-emerald-600/20 border border-emerald-500 text-emerald-400 px-4 py-2 rounded-xl flex items-center gap-2 text-sm font-medium">
              <Cpu size={16} /> AgentVault Active
            </div>
          </div>
        </div>

        {/* Right Column: Sepolia Wallet Balance Card */}
        <div className="bg-gradient-to-b from-emerald-900/40 via-neutral-900 to-black rounded-3xl p-6 border border-emerald-500/30 flex flex-col justify-between">
          <div>
            <h2 className="text-2xl font-bold mb-2">Sepolia Wallet Balance</h2>
            <p className="text-xs text-gray-400 leading-relaxed">
              Sepolia is an Ethereum testnet for testing smart contracts and blockchain apps using test ETH, without risking real funds.
            </p>
          </div>

          {/* Card Stack Preview */}
          <div className="relative h-48 mt-4">
            <div className="absolute left-0 bottom-0 w-full h-36 bg-gradient-to-r from-blue-600 to-indigo-700 rounded-2xl p-4 shadow-xl border border-blue-400/30 transform -rotate-6">
              <div className="w-8 h-6 bg-amber-200 rounded"></div>
              <p className="text-xs text-white/80 mt-6">ETH Testnet</p>
              <p className="text-sm font-bold text-white">4.8500 SepoliaETH</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}