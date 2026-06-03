/**
 * Tiny toast + confirm-modal helpers. Uses only @mantine/core (no extra deps).
 *
 *   toast.success("Saved!");
 *   toast.error("Could not delete");
 *   toast.warn("3 rows skipped");
 *
 *   await confirm({
 *     title: "Delete course?",
 *     body: <Text>This will remove all sessions and prerequisites.</Text>,
 *     confirmLabel: "Delete",
 *     danger: true,
 *   });   // resolves to true / false
 *
 * Wrap the app in <FeedbackProvider> once (already done in main.tsx).
 */
import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useState,
    type ReactNode,
} from 'react';
import { Box, Button, Group, Modal, Notification, Stack, Text } from '@mantine/core';
import { IconAlertTriangle, IconCheck, IconInfoCircle, IconX } from '@tabler/icons-react';

type ToastKind = 'success' | 'error' | 'warn' | 'info';
interface ToastItem { id: number; kind: ToastKind; message: string; }

interface ConfirmOpts {
    title: string;
    body?: ReactNode;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
}

interface FeedbackApi {
    push: (kind: ToastKind, message: string) => void;
    confirm: (opts: ConfirmOpts) => Promise<boolean>;
}

const FeedbackCtx = createContext<FeedbackApi | null>(null);

// Singleton bridge so toast/confirm() can be called outside React hooks.
let bridge: FeedbackApi | null = null;

export function FeedbackProvider({ children }: { children: ReactNode }) {
    const [toasts, setToasts] = useState<ToastItem[]>([]);
    const [confirmState, setConfirmState] = useState<
        (ConfirmOpts & { resolve: (v: boolean) => void }) | null
    >(null);

    const push = useCallback((kind: ToastKind, message: string) => {
        const id = Date.now() + Math.random();
        setToasts((cur) => [...cur, { id, kind, message }]);
        const ttl = kind === 'error' ? 6000 : kind === 'warn' ? 5000 : 3500;
        setTimeout(() => setToasts((cur) => cur.filter((t) => t.id !== id)), ttl);
    }, []);

    const confirm = useCallback(
        (opts: ConfirmOpts) =>
            new Promise<boolean>((resolve) => setConfirmState({ ...opts, resolve })),
        [],
    );

    useEffect(() => {
        bridge = { push, confirm };
        return () => {
            bridge = null;
        };
    }, [push, confirm]);

    const closeConfirm = (result: boolean) => {
        if (confirmState) confirmState.resolve(result);
        setConfirmState(null);
    };

    return (
        <FeedbackCtx.Provider value={{ push, confirm }}>
            {children}

            {/* toast stack */}
            <Box
                style={{
                    position: 'fixed',
                    top: 16,
                    right: 16,
                    zIndex: 9999,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                    maxWidth: 360,
                    pointerEvents: 'none',
                }}
            >
                {toasts.map((t) => {
                    const color =
                        t.kind === 'success'
                            ? 'teal'
                            : t.kind === 'error'
                              ? 'red'
                              : t.kind === 'warn'
                                ? 'orange'
                                : 'blue';
                    const Icon =
                        t.kind === 'success'
                            ? IconCheck
                            : t.kind === 'error'
                              ? IconX
                              : t.kind === 'warn'
                                ? IconAlertTriangle
                                : IconInfoCircle;
                    return (
                        <Notification
                            key={t.id}
                            color={color}
                            icon={<Icon size={18} />}
                            withBorder
                            radius="lg"
                            style={{ pointerEvents: 'auto', boxShadow: '0 10px 30px rgba(15,23,42,.18)' }}
                            onClose={() => setToasts((cur) => cur.filter((x) => x.id !== t.id))}
                        >
                            {t.message}
                        </Notification>
                    );
                })}
            </Box>

            {/* confirm modal */}
            <Modal
                opened={!!confirmState}
                onClose={() => closeConfirm(false)}
                title={confirmState?.title ?? ''}
                centered
                radius="xl"
            >
                {confirmState && (
                    <Stack gap="md">
                        <Box>{confirmState.body ?? <Text>Are you sure?</Text>}</Box>
                        <Group justify="flex-end" mt="sm">
                            <Button variant="subtle" color="gray" radius="lg" onClick={() => closeConfirm(false)}>
                                {confirmState.cancelLabel ?? 'Cancel'}
                            </Button>
                            <Button
                                color={confirmState.danger ? 'red' : 'brand'}
                                radius="lg"
                                onClick={() => closeConfirm(true)}
                            >
                                {confirmState.confirmLabel ?? 'Confirm'}
                            </Button>
                        </Group>
                    </Stack>
                )}
            </Modal>
        </FeedbackCtx.Provider>
    );
}

export function useFeedback(): FeedbackApi {
    const ctx = useContext(FeedbackCtx);
    if (!ctx) throw new Error('useFeedback must be inside <FeedbackProvider>');
    return ctx;
}

/** Module-level convenience handles (work after the provider has mounted). */
export const toast = {
    success: (m: string) => bridge?.push('success', m),
    error: (m: string) => bridge?.push('error', m),
    warn: (m: string) => bridge?.push('warn', m),
    info: (m: string) => bridge?.push('info', m),
};

export function confirm(opts: ConfirmOpts): Promise<boolean> {
    if (!bridge) return Promise.resolve(false);
    return bridge.confirm(opts);
}

/** Pull a useful error string out of an axios/fetch error. */
export function errMsg(e: unknown, fallback = 'Request failed'): string {
    const any = e as { response?: { data?: { detail?: unknown } }; message?: string };
    const detail = any?.response?.data?.detail;
    if (Array.isArray(detail)) {
        return detail.map((d: { msg?: string }) => d.msg || JSON.stringify(d)).join(', ');
    }
    if (typeof detail === 'string') return detail;
    return any?.message || fallback;
}
