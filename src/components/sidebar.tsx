"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { LayoutDashboard, Building2, Landmark, Tag, ArrowLeftRight, CheckSquare, BarChart2, Settings, X, Target, DollarSign, TrendingUp, ChevronLeft, ChevronRight, LineChart } from "lucide-react";

const mainNav = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/transactions", label: "Transactions", icon: ArrowLeftRight },
  { href: "/control", label: "Control", icon: CheckSquare },
  { href: "/plan", label: "Planning", icon: Target },
  { href: "/pl", label: "P&L", icon: TrendingUp },
  { href: "/analytics", label: "Analytics", icon: LineChart },
];

const settingsNav = [
  { href: "/accounts", label: "Accounts", icon: Landmark },
  { href: "/companies", label: "Companies", icon: Building2 },
  { href: "/categories", label: "Categories", icon: Tag },
  { href: "/charts", label: "Charts", icon: BarChart2 },
  { href: "/exchange-rates", label: "Exchange Rates", icon: DollarSign },
];

export function Sidebar() {
  const pathname = usePathname();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const isSettingsActive = settingsNav.some(({ href }) => pathname === href || pathname.startsWith(href + "/"));

  return (
    <aside className={`${collapsed ? "w-14" : "w-60"} relative shrink-0 flex flex-col min-h-screen bg-white border-r border-[#e8eaed] transition-all duration-200`}>

      {/* Logo + collapse toggle */}
      <div className={`flex items-center border-b border-[#e8eaed] h-[73px] ${collapsed ? "justify-center px-2" : "justify-between px-4"}`}>
        {!collapsed && (
          <div className="flex items-center gap-2.5">
            <img src="/logo.png" alt="ActiveView" className="w-8 h-8 rounded-lg object-contain shrink-0" />
            <span className="text-[#2d3748] text-[15px] font-semibold tracking-tight">Finance</span>
          </div>
        )}
        {collapsed && (
          <img src="/logo.png" alt="ActiveView" className="w-8 h-8 rounded-lg object-contain" />
        )}
        <button
          onClick={() => { setCollapsed(v => !v); setSettingsOpen(false); }}
          className="p-1.5 rounded-lg text-[#9ca3af] hover:text-[#6b7280] hover:bg-[#f3f4f6] transition-all shrink-0"
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-4 space-y-0.5">
        {mainNav.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              title={collapsed ? label : undefined}
              className={`flex items-center gap-3 px-2.5 py-2.5 rounded-lg text-[13.5px] font-medium transition-all ${
                collapsed ? "justify-center" : ""
              } ${
                active
                  ? "bg-[#e6f7f5] text-[#007a6e]"
                  : "text-[#6b7280] hover:text-[#374151] hover:bg-[#f3f4f6]"
              }`}
            >
              <Icon className={`w-[17px] h-[17px] shrink-0 ${active ? "text-[#00b9a5]" : "text-[#9ca3af]"}`} />
              {!collapsed && label}
            </Link>
          );
        })}
      </nav>

      {/* Settings flyout — inline when expanded, absolute popup when collapsed */}
      {settingsOpen && !collapsed && (
        <div className="px-3 pb-2 border-t border-[#e8eaed] pt-3 space-y-0.5">
          <div className="flex items-center justify-between px-3 pb-1">
            <span className="text-[11px] font-semibold text-[#9ca3af] uppercase tracking-wider">Settings</span>
            <button onClick={() => setSettingsOpen(false)} className="text-[#9ca3af] hover:text-[#6b7280]">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          {settingsNav.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(href + "/");
            return (
              <Link key={href} href={href} onClick={() => setSettingsOpen(false)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13.5px] font-medium transition-all ${active ? "bg-[#e6f7f5] text-[#007a6e]" : "text-[#6b7280] hover:text-[#374151] hover:bg-[#f3f4f6]"}`}>
                <Icon className={`w-[17px] h-[17px] shrink-0 ${active ? "text-[#00b9a5]" : "text-[#9ca3af]"}`} />
                {label}
              </Link>
            );
          })}
        </div>
      )}
      {settingsOpen && collapsed && (
        <div className="absolute bottom-12 left-14 z-50 bg-white border border-[#e8eaed] rounded-xl shadow-xl py-2 w-48">
          <div className="px-3 pb-1.5">
            <span className="text-[11px] font-semibold text-[#9ca3af] uppercase tracking-wider">Settings</span>
          </div>
          {settingsNav.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(href + "/");
            return (
              <Link key={href} href={href} onClick={() => setSettingsOpen(false)}
                className={`flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium transition-all ${active ? "text-[#007a6e] bg-[#e6f7f5]" : "text-[#6b7280] hover:text-[#374151] hover:bg-[#f3f4f6]"}`}>
                <Icon className={`w-4 h-4 shrink-0 ${active ? "text-[#00b9a5]" : "text-[#9ca3af]"}`} />
                {label}
              </Link>
            );
          })}
        </div>
      )}

      {/* Footer */}
      <div className={`px-2 py-3 border-t border-[#e8eaed] flex items-center ${collapsed ? "justify-center" : "justify-between px-3"}`}>
        {!collapsed && (
          <p className="text-[11px] text-[#9ca3af]">ActiveView Group <span className="text-[#d1d5db]">v{process.env.NEXT_PUBLIC_BUILD_ID ?? "dev"}</span></p>
        )}
        <button
          onClick={() => setSettingsOpen((v) => !v)}
          title="Settings"
          className={`p-2 rounded-lg transition-all ${
            settingsOpen || isSettingsActive
              ? "bg-[#e6f7f5] text-[#00b9a5]"
              : "text-[#9ca3af] hover:text-[#6b7280] hover:bg-[#f3f4f6]"
          }`}
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>
    </aside>
  );
}
