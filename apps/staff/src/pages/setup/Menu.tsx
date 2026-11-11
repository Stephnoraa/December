import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  koboToNairaInput,
  parseNairaToKobo,
  type AdminMenuCategoryDto,
  type AdminMenuItemDto,
  type StationDto,
} from '@app/shared';
import { del, errorMessage, get, patch, post, uploadImage } from '../../lib/api';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  Field,
  Input,
  Loading,
  Modal,
  Money,
  PageHeader,
  Select,
  Toggle,
} from '../../components/ui';

function useMenu() {
  return useQuery({
    queryKey: ['admin-menu'],
    queryFn: () => get<AdminMenuCategoryDto[]>('/v1/admin/menu'),
  });
}

function ItemEditor({
  item,
  categories,
  stations,
  onClose,
}: {
  item: AdminMenuItemDto | { categoryId: string };
  categories: AdminMenuCategoryDto[];
  stations: StationDto[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const existing = 'id' in item ? item : null;
  const [form, setForm] = useState({
    name: existing?.name ?? '',
    description: existing?.description ?? '',
    price: existing ? koboToNairaInput(existing.priceKobo) : '',
    categoryId: item.categoryId,
    stationId: existing?.stationId ?? stations.find((s) => s.active)?.id ?? '',
  });
  const [addOn, setAddOn] = useState({ name: '', price: '0' });
  const priceKobo = parseNairaToKobo(form.price);
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['admin-menu'] }),
      qc.invalidateQueries({ queryKey: ['checklist'] }),
    ]);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: form.name,
        description: form.description.trim() || null,
        priceKobo,
        categoryId: form.categoryId,
        stationId: form.stationId,
      };
      return existing
        ? patch(`/v1/admin/menu/items/${existing.id}`, body)
        : post('/v1/admin/menu/items', body);
    },
    onSuccess: async () => {
      await refresh();
      if (!existing) onClose();
    },
  });
  const photo = useMutation({
    mutationFn: async (file: File) => {
      if (!existing) return;
      const uploadKey = await uploadImage(
        `/v1/admin/menu/items/${existing.id}/image/upload-url`,
        file,
      );
      await post(`/v1/admin/menu/items/${existing.id}/image`, { uploadKey });
    },
    onSuccess: refresh,
  });
  const removePhoto = useMutation({
    mutationFn: () => del(`/v1/admin/menu/items/${existing!.id}/image`),
    onSuccess: refresh,
  });
  const createAddOn = useMutation({
    mutationFn: () =>
      post(`/v1/admin/menu/items/${existing!.id}/add-ons`, {
        name: addOn.name,
        priceDeltaKobo: parseNairaToKobo(addOn.price) ?? 0,
      }),
    onSuccess: async () => {
      setAddOn({ name: '', price: '0' });
      await refresh();
    },
  });
  const toggleAddOn = useMutation({
    mutationFn: (a: { id: string; isAvailable: boolean }) =>
      patch(`/v1/admin/menu/add-ons/${a.id}`, { isAvailable: a.isAvailable }),
    onSuccess: refresh,
  });
  const removeAddOn = useMutation({
    mutationFn: (id: string) => del(`/v1/admin/menu/add-ons/${id}`),
    onSuccess: refresh,
  });
  const archive = useMutation({
    mutationFn: () => del(`/v1/admin/menu/items/${existing!.id}`),
    onSuccess: async () => {
      await refresh();
      onClose();
    },
  });
  const current = existing
    ? (categories.flatMap((c) => c.items).find((i) => i.id === existing.id) ?? existing)
    : null;
  const error =
    save.error ??
    photo.error ??
    createAddOn.error ??
    toggleAddOn.error ??
    removeAddOn.error ??
    archive.error ??
    removePhoto.error;

  return (
    <div className="space-y-4">
      <ErrorBanner error={error ? errorMessage(error) : null} />
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="Name">
          {(id) => (
            <Input
              id={id}
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          )}
        </Field>
        <Field label="Description (optional)">
          {(id) => (
            <Input
              id={id}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          )}
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field
            label="Price (₦)"
            error={form.price && priceKobo === null ? 'Enter an amount like 3500 or 3500.50' : null}
          >
            {(id) => (
              <Input
                id={id}
                inputMode="decimal"
                required
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
              />
            )}
          </Field>
          <Field label="Category">
            {(id) => (
              <Select
                id={id}
                value={form.categoryId}
                onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Station">
            {(id) => (
              <Select
                id={id}
                value={form.stationId}
                onChange={(e) => setForm({ ...form, stationId: e.target.value })}
              >
                {stations
                  .filter((s) => s.active)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
        </div>
        <Button
          type="submit"
          busy={save.isPending}
          disabled={priceKobo === null || !form.stationId}
        >
          {existing ? 'Save item' : 'Add item'}
        </Button>
      </form>

      {current && (
        <>
          <div className="border-t border-slate-100 pt-4">
            <h3 className="mb-2 font-semibold">Photo</h3>
            <div className="flex items-center gap-3">
              {current.imageUrl ? (
                <img src={current.imageUrl} alt="" className="h-20 w-20 rounded-xl object-cover" />
              ) : (
                <div className="flex h-20 w-20 items-center justify-center rounded-xl bg-slate-100 text-xs text-slate-500">
                  No photo
                </div>
              )}
              <label className="cursor-pointer rounded-xl bg-white px-3 py-2 text-sm font-semibold ring-1 ring-slate-300 hover:bg-slate-50">
                {photo.isPending ? 'Uploading…' : current.imageUrl ? 'Replace' : 'Upload photo'}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) photo.mutate(f);
                    e.target.value = '';
                  }}
                />
              </label>
              {current.imageUrl && (
                <Button size="sm" variant="ghost" onClick={() => removePhoto.mutate()}>
                  Remove
                </Button>
              )}
            </div>
          </div>
          <div className="border-t border-slate-100 pt-4">
            <h3 className="font-semibold">Add-ons</h3>
            <p className="mb-2 text-sm text-slate-600">
              Optional extras customers can tick, e.g. “Extra plantain +₦500” or “With ice +₦0”.
            </p>
            <div className="divide-y divide-slate-100">
              {current.addOns.map((a) => (
                <div key={a.id} className="flex items-center justify-between py-2">
                  <span>
                    {a.name}{' '}
                    <span className="text-sm text-slate-500">
                      +<Money kobo={a.priceDeltaKobo} />
                    </span>
                  </span>
                  <div className="flex items-center gap-2">
                    <Toggle
                      label={`${a.name} available`}
                      checked={a.isAvailable}
                      onChange={(v) => toggleAddOn.mutate({ id: a.id, isAvailable: v })}
                    />
                    <Button size="sm" variant="ghost" onClick={() => removeAddOn.mutate(a.id)}>
                      Remove
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            <form
              className="mt-2 grid grid-cols-[1fr_7rem_auto] gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (addOn.name.trim() && parseNairaToKobo(addOn.price) !== null)
                  createAddOn.mutate();
              }}
            >
              <Input
                aria-label="Add-on name"
                placeholder="Add-on name"
                value={addOn.name}
                onChange={(e) => setAddOn({ ...addOn, name: e.target.value })}
              />
              <Input
                aria-label="Add-on price in naira"
                inputMode="decimal"
                value={addOn.price}
                onChange={(e) => setAddOn({ ...addOn, price: e.target.value })}
              />
              <Button type="submit" variant="secondary" busy={createAddOn.isPending}>
                Add
              </Button>
            </form>
          </div>
          <div className="border-t border-slate-100 pt-4">
            <Button
              variant="danger"
              size="sm"
              busy={archive.isPending}
              onClick={() => archive.mutate()}
            >
              Remove item from menu
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

export default function Menu() {
  const qc = useQueryClient();
  const menu = useMenu();
  const stations = useQuery({
    queryKey: ['stations'],
    queryFn: () => get<StationDto[]>('/v1/admin/stations'),
  });
  const [editing, setEditing] = useState<AdminMenuItemDto | { categoryId: string } | null>(null);
  const [newCategory, setNewCategory] = useState('');
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['admin-menu'] }),
      qc.invalidateQueries({ queryKey: ['checklist'] }),
    ]);
  const createCategory = useMutation({
    mutationFn: () => post('/v1/admin/menu/categories', { name: newCategory }),
    onSuccess: async () => {
      setNewCategory('');
      await refresh();
    },
  });
  const toggleCategory = useMutation({
    mutationFn: (c: { id: string; active: boolean }) =>
      patch(`/v1/admin/menu/categories/${c.id}`, { active: c.active }),
    onSuccess: refresh,
  });
  const availability = useMutation({
    mutationFn: (i: { id: string; isAvailable: boolean }) =>
      patch(`/v1/admin/menu/items/${i.id}/availability`, { isAvailable: i.isAvailable }),
    onSuccess: refresh,
  });
  if (menu.isLoading || stations.isLoading) return <Loading />;
  const categories = menu.data ?? [];
  const stationName = new Map((stations.data ?? []).map((s) => [s.id, s.name]));
  const error = createCategory.error ?? toggleCategory.error ?? availability.error;
  return (
    <div>
      <PageHeader
        title="Menu"
        subtitle="Switch items off when they run out: customers see it instantly."
      />
      <ErrorBanner error={error ? errorMessage(error) : null} />
      {!(stations.data ?? []).some((s) => s.active) && (
        <EmptyState title="Add a station first">
          Every item is sent to a station (e.g. Kitchen or Bar).
        </EmptyState>
      )}
      <Card className="mb-4">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (newCategory.trim()) createCategory.mutate();
          }}
        >
          <Input
            aria-label="New category"
            placeholder="New category, e.g. Grills"
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
          />
          <Button type="submit" busy={createCategory.isPending}>
            Add category
          </Button>
        </form>
      </Card>
      <div className="space-y-4">
        {categories.map((c) => (
          <Card key={c.id} className="p-0">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <div className="flex items-center gap-2">
                <h2 className="font-bold">{c.name}</h2>
                {!c.active && <Badge tone="amber">hidden</Badge>}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setEditing({ categoryId: c.id })}
                >
                  + Item
                </Button>
                <Toggle
                  label={`${c.name} visible`}
                  checked={c.active}
                  onChange={(active) => toggleCategory.mutate({ id: c.id, active })}
                />
              </div>
            </div>
            {c.items.length === 0 ? (
              <p className="px-4 py-3 text-sm text-slate-500">No items yet.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {c.items.map((i) => (
                  <div key={i.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <button
                      type="button"
                      className="flex min-w-0 items-center gap-3 text-left"
                      onClick={() => setEditing(i)}
                    >
                      {i.imageUrl ? (
                        <img
                          src={i.imageUrl}
                          alt=""
                          className="h-12 w-12 shrink-0 rounded-lg object-cover"
                        />
                      ) : (
                        <div className="h-12 w-12 shrink-0 rounded-lg bg-slate-100" />
                      )}
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{i.name}</p>
                        <p className="text-sm text-slate-600">
                          <Money kobo={i.priceKobo} /> · {stationName.get(i.stationId) ?? 'Station'}
                          {i.addOns.length > 0 &&
                            ` · ${i.addOns.length} add-on${i.addOns.length > 1 ? 's' : ''}`}
                        </p>
                      </div>
                    </button>
                    <div className="flex items-center gap-2">
                      {!i.isAvailable && <Badge tone="red">sold out</Badge>}
                      <Toggle
                        label={`${i.name} available`}
                        checked={i.isAvailable}
                        onChange={(v) => availability.mutate({ id: i.id, isAvailable: v })}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        ))}
      </div>
      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing && 'id' in editing ? `Edit ${editing.name}` : 'New item'}
        wide
      >
        {editing && (
          <ItemEditor
            item={editing}
            categories={categories}
            stations={stations.data ?? []}
            onClose={() => setEditing(null)}
          />
        )}
      </Modal>
    </div>
  );
}
