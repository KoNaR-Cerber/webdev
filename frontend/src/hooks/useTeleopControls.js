import { useState, useEffect, useCallback, useMemo, act } from "react";

export const useTeleopControls = (keyMapping) => {
    const [activeKeys, setActiveKeys] = useState({});

    // handlers for on-screen buttons
    const handlePointerDown = useCallback((action) => {
        setActiveKeys((prev) => ({...prev, [action]: true}));
    }, []);

    const handlePointerUp = useCallback((action) => {
        setActiveKeys((prev) => ({ ...prev, [action]: false }));
    }, []);

    const mapping = useMemo(() => keyMapping, [keyMapping]);

    useEffect(() => {
        const handleKeyDown = (e) => {
            const action = mapping[e.key.toUpperCase()];
            if (action) {
                setActiveKeys((prev) => {
                    if (prev[action]) return prev; // Ignore OS auto-repeat
                    return { ...prev, [action]: true };
                });
            }
        };

        const handleKeyUp = (e) => {
            const action = mapping[e.key.toUpperCase()];
            if (action) {
                setActiveKeys((prev) => ({ ...prev, [action]: false }));
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
        };
    }, [mapping]);

    return { activeKeys, handlePointerDown, handlePointerUp };
}