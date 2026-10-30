import React from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/router";
import { useHotkeys } from "react-hotkeys-hook";
import { useSearch } from "./Search/SearchProvider";
import IonIcon from "./Icon";
import { AnimatePresence, motion } from "framer-motion";
import { useTheme } from "../hooks/useDarkMode";

const navigation = [
    { href: "/recap", label: "월말결산" },
    { href: "/forest", label: "문서" },
];

export const Header: React.FC = () => {
    const openSearch = useSearch();
    const [showMenu, setShowMenu] = React.useState(false);
    const [showThemeMenu, setShowThemeMenu] = React.useState(false);
    const [mounted, setMounted] = React.useState(false);
    const { theme, setTheme } = useTheme();
    const router = useRouter();

    React.useEffect(() => {
        setMounted(true);
    }, []);

    useHotkeys('/', event => {
        openSearch();
        event.preventDefault();
        event.stopPropagation();
    });

    useHotkeys('esc', () => {
        setShowMenu(false);
        setShowThemeMenu(false);
    }, { enableOnFormTags: true });

    React.useEffect(() => {
        setShowMenu(false);
        setShowThemeMenu(false);
    }, [router.asPath]);

    React.useEffect(() => {
        if (!showMenu) return;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => {
            document.body.style.overflow = previousOverflow;
        };
    }, [showMenu]);

    const currentThemeIcon = theme === 'dark' ? "moon-outline" : theme === 'light' ? "sunny-outline" : "desktop-outline";

    return (
        <header
            className={`site-header${showThemeMenu ? " header-menu-open" : ""}`}
            style={{ mask: showThemeMenu ? 'unset' : 'linear-gradient(to bottom, var(--background) 45%, rgba(0, 0, 0, 0) 100%)', WebkitMask: showThemeMenu ? 'unset' : 'linear-gradient(to bottom, var(--background) 45%, rgba(0, 0, 0, 0) 100%)' }}>
            <div className="container mx-auto px-4 py-8 header-content">
                <div className="header-leading">
                    <button
                        type="button"
                        className="header-menu-button"
                        aria-label="메뉴 열기"
                        aria-expanded={showMenu}
                        onClick={() => setShowMenu(true)}
                    >
                        <IonIcon name="menu-outline" />
                    </button>
                    <Link href="/" className="no-underline text-inherit">
                        <h3 className="text-sm m-0 font-black">프리머그의 Blog</h3>
                    </Link>
                    <nav className="header-navigation" aria-label="주요 메뉴">
                        {navigation.map((item) => (
                            <Link
                                key={item.href}
                                href={item.href}
                                className={`header-navigation-link no-underline ${router.pathname.startsWith(item.href) ? "is-active" : ""}`}
                            >
                                {item.label}
                            </Link>
                        ))}
                    </nav>
                </div>

                <div className="flex items-center gap-1">
                    <button
                        type="button"
                        className="header-search-button"
                        aria-label="검색 열기"
                        onClick={() => openSearch()}
                    >
                        <IonIcon name="search" style={{ marginTop: '4px' }} />
                    </button>

                    <div className="relative header-theme-wrapper hidden sm:block">
                        <button
                            type="button"
                            className="header-theme-button"
                            aria-label="테마 설정"
                            onClick={() => setShowThemeMenu((prev) => !prev)}
                        >
                            <IonIcon name={currentThemeIcon} style={{ marginTop: '4px' }} />
                        </button>

                        <AnimatePresence>
                            {showThemeMenu && (
                                <>
                                    <div
                                        className="fixed inset-0 z-40"
                                        onClick={() => setShowThemeMenu(false)}
                                    />
                                    <motion.div
                                        className="header-theme-dropdown"
                                        initial={{ opacity: 0, scale: 0.95, y: -6 }}
                                        animate={{ opacity: 1, scale: 1, y: 0 }}
                                        exit={{ opacity: 0, scale: 0.95, y: -6 }}
                                        transition={{ duration: 0.15 }}
                                    >
                                        <button
                                            type="button"
                                            className={`header-theme-option ${theme === 'system' ? 'is-active' : ''}`}
                                            onClick={() => { setTheme('system'); setShowThemeMenu(false); }}
                                        >
                                            <IonIcon name="desktop-outline" />
                                            <span>시스템</span>
                                            {theme === 'system' && <IonIcon name="checkmark-outline" style={{ marginLeft: 'auto' }} />}
                                        </button>
                                        <button
                                            type="button"
                                            className={`header-theme-option ${theme === 'light' ? 'is-active' : ''}`}
                                            onClick={() => { setTheme('light'); setShowThemeMenu(false); }}
                                        >
                                            <IonIcon name="sunny-outline" />
                                            <span>라이트</span>
                                            {theme === 'light' && <IonIcon name="checkmark-outline" style={{ marginLeft: 'auto' }} />}
                                        </button>
                                        <button
                                            type="button"
                                            className={`header-theme-option ${theme === 'dark' ? 'is-active' : ''}`}
                                            onClick={() => { setTheme('dark'); setShowThemeMenu(false); }}
                                        >
                                            <IonIcon name="moon-outline" />
                                            <span>다크</span>
                                            {theme === 'dark' && <IonIcon name="checkmark-outline" style={{ marginLeft: 'auto' }} />}
                                        </button>
                                    </motion.div>
                                </>
                            )}
                        </AnimatePresence>
                    </div>
                </div>
            </div>

            {mounted && createPortal(
                <AnimatePresence>
                    {showMenu && (
                        <motion.div className="mobile-menu" role="dialog" aria-modal="true" aria-label="주요 메뉴" exit={{ opacity: 0, transition: { duration: 0.25 } }}>
                            <motion.button
                                type="button"
                                className="mobile-menu-backdrop no-blur"
                                aria-label="메뉴 닫기"
                                onClick={() => setShowMenu(false)}
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                transition={{ duration: 0.25 }}
                            />
                            <motion.div
                                className="mobile-menu-panel"
                                style={{ width: '60%', top: "-25px" }}
                                initial={{ opacity: 0, scale: 0.5, x: "-45%", y: -18 }}
                                animate={{ opacity: 1, scale: 0.75, x: "-35%", y: 0 }}
                                exit={{ opacity: 0, scale: 0.5, x: "-35%", y: -18 }}
                                transition={{ type: "spring", stiffness: 380, damping: 32 }}
                            >
                                <nav className="mobile-menu-options" aria-label="모바일 주요 메뉴">
                                    {navigation.map((item) => {
                                        const active = router.pathname.startsWith(item.href);
                                        return (
                                            <Link
                                                key={item.href}
                                                href={item.href}
                                                className={`mobile-menu-link no-underline text-inherit ${active ? "is-active" : ""}`}
                                                onClick={() => setShowMenu(false)}
                                            >
                                                <span>{item.label}</span>
                                                <IonIcon name={active ? "checkmark-circle" : "chevron-forward-outline"} />
                                            </Link>
                                        );
                                    })}
                                </nav>
                                <div className="flex items-center justify-around mt-4 pt-3 border-t border-gray-200 dark:border-gray-800">
                                    <button
                                        type="button"
                                        className={`mobile-theme-btn ${theme === 'system' ? 'is-active' : ''}`}
                                        onClick={() => setTheme('system')}
                                    >
                                        <IonIcon name="desktop-outline" />
                                        <span>시스템</span>
                                    </button>
                                    <button
                                        type="button"
                                        className={`mobile-theme-btn ${theme === 'light' ? 'is-active' : ''}`}
                                        onClick={() => setTheme('light')}
                                    >
                                        <IonIcon name="sunny-outline" />
                                        <span>라이트</span>
                                    </button>
                                    <button
                                        type="button"
                                        className={`mobile-theme-btn ${theme === 'dark' ? 'is-active' : ''}`}
                                        onClick={() => setTheme('dark')}
                                    >
                                        <IonIcon name="moon-outline" />
                                        <span>다크</span>
                                    </button>
                                </div>
                            </motion.div>
                        </motion.div>
                    )}
                </AnimatePresence>,
                document.body
            )}

        </header>
    );
}
