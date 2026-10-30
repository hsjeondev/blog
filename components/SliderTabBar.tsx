"use client"
import React, { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useRouter } from 'next/navigation'
import IonIcon from "./Icon"

const tabs = [
    { id: 'diary', label: '일지', path: '/forest' },
    { id: 'document', label: '문서', path: '/forest/docs' }
]

export const SliderTabBar: React.FC<any> = (() => {
    const [activeTab, setActiveTab] = useState(tabs[0].id)
    const router = useRouter()

    const handleTabChange = (tabId: string, path: string) => {
        setActiveTab(tabId)
        router.push(path)
    }

    useEffect(() => {
        const path = window.location.pathname
        const tab = tabs.find((tab) => path === tab.path)
        if (tab) {
            setActiveTab(tab.id)
        }
    }, [])

    return (
        <div className="fixed top-8 left-8 right-0 flex justify-start items-center z-50 gap-2 w-fit">
            <button
                onClick={() => router.push('/')}
                style={{ backgroundColor: 'var(--blur)' }}
                className="flex items-center justify-center px-4 h-11 aspect-square rounded-full bg-white dark:bg-gray-800 text-gray-400 backdrop-blur shadow-lg border border-gray-300 dark:border-gray-800"
            >
                <IonIcon name="chevron-back-outline" className="text-gray-400" />
            </button>
        </div>
    )
})
