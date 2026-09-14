<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Resources\UserResource;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rule;

class UserController extends Controller
{
    public function index(Request $request)
    {
        $this->authorizePatron($request);

        return UserResource::collection(
            User::query()
                ->orderByRaw("CASE WHEN role = 'patron' THEN 0 ELSE 1 END")
                ->orderBy('name')
                ->get()
        );
    }

    public function store(Request $request): JsonResponse
    {
        $this->authorizePatron($request);

        $validated = $request->validate([
            'name' => ['required', 'string', 'max:100'],
            'email' => ['required', 'email', 'max:255', 'unique:users,email'],
            'password' => ['required', 'string', 'min:4'],
            'role' => ['required', Rule::in(['patron', 'worker'])],
            'is_active' => ['sometimes', 'boolean'],
        ]);

        $user = User::create([
            'name' => $validated['name'],
            'email' => $validated['email'],
            'password' => Hash::make($validated['password']),
            'role' => $validated['role'],
            'is_active' => $validated['is_active'] ?? true,
        ]);

        return (new UserResource($user))
            ->response()
            ->setStatusCode(201);
    }

    public function update(Request $request, User $user): UserResource
    {
        $this->authorizePatron($request);

        $validated = $request->validate([
            'name' => ['required', 'string', 'max:100'],
            'email' => [
                'required',
                'email',
                'max:255',
                Rule::unique('users', 'email')->ignore($user->id),
            ],
            'password' => ['nullable', 'string', 'min:4'],
            'role' => ['required', Rule::in(['patron', 'worker'])],
            'is_active' => ['sometimes', 'boolean'],
        ]);

        $this->ensureActivePatronRemains($user, $validated);

        $data = [
            'name' => $validated['name'],
            'email' => $validated['email'],
            'role' => $validated['role'],
            'is_active' => $validated['is_active'] ?? $user->is_active,
        ];

        if (filled($validated['password'] ?? null)) {
            $data['password'] = Hash::make($validated['password']);
        }

        $user->update($data);

        return new UserResource($user);
    }

    public function destroy(Request $request, User $user): JsonResponse
    {
        $this->authorizePatron($request);

        if ($user->role === 'patron' && $user->is_active && $this->activePatronCount() <= 1) {
            return response()->json([
                'message' => 'Impossible de supprimer le dernier patron actif.',
            ], 422);
        }

        $user->delete();

        return response()->json([
            'message' => 'Utilisateur supprimé.',
        ]);
    }

    private function authorizePatron(Request $request): void
    {
        abort_if($request->user()?->role !== 'patron', 403, 'Only patron users can manage users.');
    }

    /**
     * @param  array<string, mixed>  $validated
     */
    private function ensureActivePatronRemains(User $user, array $validated): void
    {
        $willBePatron = ($validated['role'] ?? $user->role) === 'patron';
        $willBeActive = (bool) ($validated['is_active'] ?? $user->is_active);

        if (
            $user->role === 'patron'
            && $user->is_active
            && (! $willBePatron || ! $willBeActive)
            && $this->activePatronCount() <= 1
        ) {
            abort(422, 'Impossible de désactiver le dernier patron actif.');
        }
    }

    private function activePatronCount(): int
    {
        return User::query()
            ->where('role', 'patron')
            ->where('is_active', true)
            ->count();
    }
}
