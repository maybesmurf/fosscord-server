/*
	Spacebar: A FOSS re-implementation and extension of the Discord.com backend.
	Copyright (C) 2023 Spacebar and Spacebar Contributors
	
	This program is free software: you can redistribute it and/or modify
	it under the terms of the GNU Affero General Public License as published
	by the Free Software Foundation, either version 3 of the License, or
	(at your option) any later version.
	
	This program is distributed in the hope that it will be useful,
	but WITHOUT ANY WARRANTY; without even the implied warranty of
	MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
	GNU Affero General Public License for more details.
	
	You should have received a copy of the GNU Affero General Public License
	along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { Router, Request, Response } from "express";
import {
	User,
	Member,
	UserProfileModifySchema,
	handleFile,
	PrivateUserProjection,
	emitEvent,
	UserUpdateEvent,
} from "@spacebar/util";
import { route } from "@spacebar/api";

const router: Router = Router();

router.get(
	"/",
	route({ test: { response: { body: "UserProfileResponse" } } }),
	async (req: Request, res: Response) => {
		if (req.params.id === "@me") req.params.id = req.user_id;

		const { guild_id, with_mutual_guilds } = req.query;

		const user = await User.getPublicUser(req.params.id, {
			relations: ["connected_accounts"],
		});

		const mutual_guilds: object[] = [];
		let premium_guild_since;

		if (with_mutual_guilds == "true") {
			const requested_member = await Member.find({
				where: { id: req.params.id },
			});
			const self_member = await Member.find({
				where: { id: req.user_id },
			});

			for (const rmem of requested_member) {
				if (rmem.premium_since) {
					if (premium_guild_since) {
						if (premium_guild_since > rmem.premium_since) {
							premium_guild_since = rmem.premium_since;
						}
					} else {
						premium_guild_since = rmem.premium_since;
					}
				}
				for (const smem of self_member) {
					if (smem.guild_id === rmem.guild_id) {
						mutual_guilds.push({
							id: rmem.guild_id,
							nick: rmem.nick,
						});
					}
				}
			}
		}

		const guild_member =
			guild_id && typeof guild_id == "string"
				? await Member.findOneOrFail({
						where: { id: req.params.id, guild_id: guild_id },
						relations: ["roles"],
				  })
				: undefined;

		// TODO: make proper DTO's in util?

		const userDto = {
			username: user.username,
			discriminator: user.discriminator,
			id: user.id,
			public_flags: user.public_flags,
			avatar: user.avatar,
			accent_color: user.accent_color,
			banner: user.banner,
			bio: req.user_bot ? null : user.bio,
			bot: user.bot,
		};

		const userProfile = {
			bio: req.user_bot ? null : user.bio,
			accent_color: user.accent_color,
			banner: user.banner,
			pronouns: user.pronouns,
			theme_colors: user.theme_colors,
		};

		const guildMemberDto = guild_member
			? {
					avatar: guild_member.avatar,
					banner: guild_member.banner,
					bio: req.user_bot ? null : guild_member.bio,
					communication_disabled_until:
						guild_member.communication_disabled_until,
					deaf: guild_member.deaf,
					flags: user.flags,
					is_pending: guild_member.pending,
					pending: guild_member.pending, // why is this here twice, discord?
					joined_at: guild_member.joined_at,
					mute: guild_member.mute,
					nick: guild_member.nick,
					premium_since: guild_member.premium_since,
					roles: guild_member.roles
						.map((x) => x.id)
						.filter((id) => id != guild_id),
					user: userDto,
			  }
			: undefined;

		const guildMemberProfile = {
			accent_color: null,
			banner: guild_member?.banner || null,
			bio: guild_member?.bio || "",
			guild_id,
		};
		res.json({
			connected_accounts: user.connected_accounts,
			premium_guild_since: premium_guild_since, // TODO
			premium_since: user.premium_since, // TODO
			mutual_guilds: mutual_guilds, // TODO {id: "", nick: null} when ?with_mutual_guilds=true
			user: userDto,
			premium_type: user.premium_type,
			profile_themes_experiment_bucket: 4, // TODO: This doesn't make it available, for some reason?
			user_profile: userProfile,
			guild_member: guild_id && guildMemberDto,
			guild_member_profile: guild_id && guildMemberProfile,
		});
	},
);

router.patch(
	"/",
	route({ body: "UserProfileModifySchema" }),
	async (req: Request, res: Response) => {
		const body = req.body as UserProfileModifySchema;

		if (body.banner)
			body.banner = await handleFile(
				`/banners/${req.user_id}`,
				body.banner as string,
			);
		const user = await User.findOneOrFail({
			where: { id: req.user_id },
			select: [...PrivateUserProjection, "data"],
		});

		user.assign(body);
		await user.save();

		// eslint-disable-next-line @typescript-eslint/ban-ts-comment
		// @ts-ignore
		delete user.data;

		// TODO: send update member list event in gateway
		await emitEvent({
			event: "USER_UPDATE",
			user_id: req.user_id,
			data: user,
		} as UserUpdateEvent);

		res.json({
			accent_color: user.accent_color,
			bio: user.bio,
			banner: user.banner,
			theme_colors: user.theme_colors,
			pronouns: user.pronouns,
		});
	},
);

export default router;
