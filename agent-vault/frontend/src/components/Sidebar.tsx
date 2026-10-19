type SidebarProps = {
  activeTab: string;
  setActiveTab: (tab: string) => void;
};

export default function Sidebar({ activeTab, setActiveTab }: SidebarProps) {
  return (
    <aside style={{ width: '96px', background: '#000', borderRight: '1px solid #111', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between', padding: '32px 0', position: 'fixed', height: '100vh', zIndex: 50 }}>
      {/* Sidebar Content */}
    </aside>
  );
}