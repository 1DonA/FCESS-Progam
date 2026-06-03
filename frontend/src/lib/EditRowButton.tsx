/**
 * Tiny "Edit" icon button. Opens a modal whose body is supplied by the caller,
 * collects form values via collectModalForm (already used by feedback.tsx),
 * and on confirm sends them to `apiClient.patch(endpoint, body)`.
 *
 *   <EditRowButton
 *     title="Edit department"
 *     endpoint={`/catalog/departments/${d.id}`}
 *     fields={[
 *       { name: 'code', label: 'Code',  value: d.code },
 *       { name: 'name', label: 'Name',  value: d.name },
 *     ]}
 *     onSaved={refresh}
 *   />
 */
import { useState } from 'react';
import {
    ActionIcon, Button, Group, Modal, NumberInput, Select, Stack, TextInput,
} from '@mantine/core';
import { IconPencil } from '@tabler/icons-react';
import { apiClient } from '../api/client';
import { errMsg, toast } from './feedback';

export type EditField =
    | { kind?: 'text'; name: string; label: string; value: string; placeholder?: string; required?: boolean }
    | { kind: 'number'; name: string; label: string; value: number; min?: number; step?: number }
    | { kind: 'select'; name: string; label: string; value: string; options: { value: string; label: string }[]; searchable?: boolean };

interface Props {
    title: string;
    endpoint: string;             // e.g. /catalog/departments/{id}
    fields: EditField[];
    onSaved?: () => void;
    /** Hook to transform the form values before PATCHing (numbers, trimming, …) */
    transform?: (form: Record<string, any>) => Record<string, any>;
}

export function EditRowButton({ title, endpoint, fields, onSaved, transform }: Props) {
    const [opened, setOpened] = useState(false);
    const [saving, setSaving] = useState(false);
    const [values, setValues] = useState<Record<string, any>>(() => {
        const init: Record<string, any> = {};
        fields.forEach((f) => { init[f.name] = (f as any).value; });
        return init;
    });

    const open = () => {
        // re-seed in case the row was updated since mount
        const init: Record<string, any> = {};
        fields.forEach((f) => { init[f.name] = (f as any).value; });
        setValues(init);
        setOpened(true);
    };

    const save = async () => {
        setSaving(true);
        try {
            const body = transform ? transform(values) : values;
            await apiClient.patch(endpoint, body);
            toast.success('Saved.');
            setOpened(false);
            onSaved?.();
        } catch (e) {
            toast.error(errMsg(e, 'Could not save changes.'));
        } finally {
            setSaving(false);
        }
    };

    return (
        <>
            <ActionIcon variant="subtle" size="sm" color="brand" onClick={open} title="Edit">
                <IconPencil size={15} />
            </ActionIcon>

            <Modal opened={opened} onClose={() => setOpened(false)} title={title} radius="xl" centered size="lg">
                <Stack gap="md">
                    {fields.map((f) => {
                        const v = values[f.name];
                        const set = (val: any) => setValues((s) => ({ ...s, [f.name]: val }));
                        if (f.kind === 'number') {
                            return (
                                <NumberInput
                                    key={f.name} label={f.label} radius="lg"
                                    value={v as number | undefined}
                                    onChange={(n) => set(typeof n === 'number' ? n : Number(n) || 0)}
                                    min={f.min} step={f.step}
                                />
                            );
                        }
                        if (f.kind === 'select') {
                            return (
                                <Select
                                    key={f.name} label={f.label} radius="lg"
                                    data={f.options} value={(v as string) || null}
                                    onChange={(val) => set(val ?? '')}
                                    searchable={f.searchable}
                                />
                            );
                        }
                        return (
                            <TextInput
                                key={f.name} label={f.label} radius="lg"
                                value={(v as string) ?? ''}
                                onChange={(e) => set(e.currentTarget.value)}
                                placeholder={(f as any).placeholder}
                                required={(f as any).required}
                            />
                        );
                    })}
                    <Group justify="flex-end" mt="sm">
                        <Button variant="subtle" color="gray" radius="lg" onClick={() => setOpened(false)}>Cancel</Button>
                        <Button loading={saving} onClick={save} radius="lg"
                            variant="gradient" gradient={{ from: 'brand.6', to: 'sky.5' }}>
                            Save
                        </Button>
                    </Group>
                </Stack>
            </Modal>
        </>
    );
}
