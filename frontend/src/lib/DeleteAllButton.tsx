/**
 * Inline "Delete all" button — scoped wipe of one entity type.
 * Each section (Courses, Lecturers, Departments, Assignments, Rooms) drops
 * this in next to its "+ New" button.
 *
 *   <DeleteAllButton scope="courses" label="Delete all courses" onDone={refresh} />
 */
import { useState } from 'react';
import { Button, Stack, Text } from '@mantine/core';
import { IconTrash } from '@tabler/icons-react';
import { apiClient } from '../api/client';
import { confirm, errMsg, toast } from './feedback';

export type WipeScope = 'departments' | 'courses' | 'faculty' | 'assignments' | 'rooms' | 'prerequisites';

interface Props {
    scope: WipeScope;
    label?: string;
    onDone?: () => void;
    /** When true, the cascade warning is shown — e.g. for departments. */
    cascade?: boolean;
}

const NICE: Record<WipeScope, string> = {
    departments: 'departments',
    courses: 'courses',
    faculty: 'lecturers',
    assignments: 'assignments',
    rooms: 'rooms',
    prerequisites: 'prerequisites',
};

export function DeleteAllButton({ scope, label, onDone, cascade }: Props) {
    const [busy, setBusy] = useState(false);

    const handleClick = async () => {
        const noun = NICE[scope];
        const ok = await confirm({
            title: `Delete all ${noun}?`,
            danger: true,
            confirmLabel: `Yes, delete every ${scope === 'faculty' ? 'lecturer' : noun.slice(0, -1)}`,
            body: (
                <Stack gap={6}>
                    <Text size="sm">
                        This permanently removes <strong>every {noun === 'lecturers' ? 'lecturer' : noun.slice(0, -1)}</strong> in the database.
                    </Text>
                    {cascade && (
                        <Text size="sm" c="dimmed">
                            Anything that depends on them — sessions, lecturer assignments
                            {scope === 'departments' ? ', courses, lecturers, prerequisites' : ''}
                            {scope === 'courses' ? ', prerequisites, sections' : ''}
                            {scope === 'rooms' ? ', sessions' : ''}
                            {' '}— will be removed as well.
                        </Text>
                    )}
                    <Text size="sm" c="red" fw={600}>This cannot be undone.</Text>
                </Stack>
            ),
        });
        if (!ok) return;
        setBusy(true);
        try {
            const res = await apiClient.post<{ deleted: Record<string, number> }>(
                '/catalog/wipe', null, { params: { scope } },
            );
            const summary = Object.entries(res.data.deleted)
                .filter(([, n]) => n > 0)
                .map(([k, n]) => `${n} ${k}`)
                .join(', ') || 'nothing — table was already empty';
            toast.success(`Deleted: ${summary}.`);
            onDone?.();
        } catch (e) {
            toast.error(errMsg(e, `Could not delete ${noun}.`));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Button
            variant="light"
            color="red"
            radius="lg"
            leftSection={<IconTrash size={16} />}
            loading={busy}
            onClick={handleClick}
        >
            {label ?? `Delete all ${noun_for(scope)}`}
        </Button>
    );
}

function noun_for(scope: WipeScope): string {
    return scope === 'faculty' ? 'lecturers' : scope;
}
