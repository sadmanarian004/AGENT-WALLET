import React from 'react';
import { ShieldCheck, Lock, AlertTriangle, Sliders } from 'lucide-react';

export default function RiskControlPanel() {
  return (
    <div className="min-h-screen bg-black text-white p-8 pl-28">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-emerald-400 mb-2">Risk Controls & Guardrails</h1>
        <p className="text-gray-400 text-sm mb-8">Manage your transaction limits and AI security barriers in real time.</p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-neutral-900 border border-neutral-800 p-6 rounded-3xl">
            <Lock className="text-emerald-400 mb-4" size={28} />
            <h3 className="font-bold text-lg mb-1">Daily Spending Limit</h3>
            <p className="text-xs text-gray-400 mb-4">Cap maximum daily outlays instantly.</p>
            <span className="text-emerald-400 font-semibold">$1,500.00 / day</span>
          </div>

          <div className="bg-neutral-900 border border-neutral-800 p-6 rounded-3xl">
            <ShieldCheck className="text-emerald-400 mb-4" size={28} />
            <h3 className="font-bold text-lg mb-1">AI Guardrails</h3>
            <p className="text-xs text-gray-400 mb-4">Active anomaly detection enabled.</p>
            <span className="text-emerald-400 font-semibold">Strict Mode</span>
          </div>

          <div className="bg-neutral-900 border border-neutral-800 p-6 rounded-3xl">
            <Sliders className="text-emerald-400 mb-4" size={28} />
            <h3 className="font-bold text-lg mb-1">Auto-Freeze</h3>
            <p className="text-xs text-gray-400 mb-4">Lock wallet on suspicious gas spikes.</p>
            <span className="text-emerald-400 font-semibold">Enabled</span>
          </div>
        </div>
      </div>
    </div>
  );
}