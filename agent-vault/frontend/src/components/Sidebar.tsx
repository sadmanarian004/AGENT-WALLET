import { Home, Sparkles, ShieldCheck, FileText, LogOut } from 'lucide-react';

type Page = 'overview' | 'agent' | 'controls' | 'audit';

type SidebarProps = {
  activeTab: Page;
  setActiveTab: (tab: Page) => void;
  onLogout: () => void;
};

export default function Sidebar({ activeTab, setActiveTab, onLogout }: SidebarProps) {
  return (
    <aside style={{
      width: '96px',
      background: '#000',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '24px 0',
      position: 'fixed',
      height: '100vh',
      zIndex: 50,
      left: 0,
      top: 0
    }}>
      {/* Top Logo / Brand capsule */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px' }}>
        <div style={{
          width: '56px',
          height: '56px',
          background: '#fff',
          borderRadius: '24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
        }}>
          <div style={{ color: '#059669', fontWeight: 900, fontSize: '20px' }}>⚡</div>
        </div>

        {/* Navigation Capsule */}
        <div style={{
          background: '#fff',
          borderRadius: '32px',
          padding: '12px 8px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)'
        }}>
          <button
            onClick={() => setActiveTab('overview')}
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: activeTab === 'overview' ? '#059669' : 'transparent',
              color: activeTab === 'overview' ? '#fff' : '#4b5563',
              border: 'none',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
            title="Overview"
          >
            <Home size={22} />
          </button>

          <button
            onClick={() => setActiveTab('agent')}
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: activeTab === 'agent' ? '#059669' : 'transparent',
              color: activeTab === 'agent' ? '#fff' : '#4b5563',
              border: 'none',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
            title="AI Agent"
          >
            <Sparkles size={22} />
          </button>

          <button
            onClick={() => setActiveTab('controls')}
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: activeTab === 'controls' ? '#059669' : 'transparent',
              color: activeTab === 'controls' ? '#fff' : '#4b5563',
              border: 'none',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
            title="Risk Controls"
          >
            <ShieldCheck size={22} />
          </button>

          <button
            onClick={() => setActiveTab('audit')}
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: activeTab === 'audit' ? '#059669' : 'transparent',
              color: activeTab === 'audit' ? '#fff' : '#4b5563',
              border: 'none',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
            title="Audit Log"
          >
            <FileText size={22} />
          </button>
        </div>
      </div>

      {/* Bottom Capsule: Logout & Profile */}
      <div style={{
        background: '#fff',
        borderRadius: '32px',
        padding: '12px 8px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.4)'
      }}>
        <button
          onClick={onLogout}
          style={{
            width: '48px',
            height: '48px',
            borderRadius: '20px',
            background: 'transparent',
            border: 'none',
            color: '#4b5563',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
          title="Log out"
        >
          <LogOut size={20} />
        </button>

        <div style={{
          width: '48px',
          height: '48px',
          borderRadius: '20px',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#059669'
        }}>
          <img
            src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&h=100&fit=crop&crop=faces"
            alt="Profile"
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        </div>
      </div>
    </aside>
  );
}