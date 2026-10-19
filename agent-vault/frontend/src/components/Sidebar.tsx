import React from 'react';
import { Home, Search, Sparkles, ShieldCheck, BarChart3, LogOut } from 'lucide-react';

export default function Sidebar({ activeTab, setActiveTab }) {
  const navItems = [
    { id: 'home', icon: Home, label: 'Home' },
    { id: 'search', icon: Search, label: 'Search' },
    { id: 'ai', icon: Sparkles, label: 'AI Agent' },
    { id: 'risk', icon: ShieldCheck, label: 'Risk Control' },
    { id: 'analytics', icon: BarChart3, label: 'Analytics' },
  ];

  return (
    <aside className="w-24 bg-black flex flex-col justify-between items-center py-8 h-screen border-r border-gray-900 fixed left-0 top-0 z-50">
      <div className="flex flex-col items-center gap-6">
        {/* Top Logo / Icon */}
        <div className="w-12 h-12 bg-emerald-500/10 rounded-2xl flex items-center justify-center text-emerald-400 font-bold border border-emerald-500/30">
          AV
        </div>

        {/* Navigation Icons */}
        <nav className="flex flex-col gap-4 mt-6">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all ${
                  isActive
                    ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/30'
                    : 'text-gray-400 hover:bg-gray-900 hover:text-white'
                }`}
              >
                <Icon size={22} />
              </button>
            );
          })}
        </nav>
      </div>

      {/* Bottom Profile / Logout */}
      <div className="flex flex-col items-center gap-4">
        <button className="w-12 h-12 rounded-2xl flex items-center justify-center text-gray-400 hover:text-white hover:bg-gray-900">
          <LogOut size={20} />
        </button>
        <div className="w-10 h-10 rounded-full overflow-hidden border border-emerald-500/50">
          <img src="https://images.unsplash.com/photo-1534528741775-53994a69daeb" alt="User" className="w-full h-full object-cover" />
        </div>
      </div>
    </aside>
  );
}