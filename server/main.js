import { Meteor } from 'meteor/meteor';
import fbgraph from 'fbgraph';
import { Relations, Friends, UserData, Notes, LastReciprocated } from '../both/collections.js'

Meteor.startup(() => {
  // code to run on server at startup
});

function updateOnReciprocation(senderId, receiverId, type){
    let selector = {"senderId":senderId, "receiverId":receiverId, "type":type};
    Relations.update(selector, {$set: {"reciprocated":true}})
    let doc = {"senderId":senderId, "receiverId":receiverId, "type":type, "datetime":Date()}
    LastReciprocated.upsert(selector, doc)
}

function checkAndProcessReciprocity(senderId, receiverId, type){
    if (reciprocates(senderId, receiverId, type)) {
        email1 = getEmail(senderId);
        email2 = getEmail(receiverId);
        name1 = getName(senderId);
        name2 = getName(receiverId);
        Email.send({
            cc: [email1, email2],
            from:"matchmaker@reciprocity.io",
            subject:"Test email",
            text:name1 + " and " + name2 + " should " + type,
        })
        updateOnReciprocation(senderId, receiverId, type)
        updateOnReciprocation(receiverId, senderId, type)
    }
}

function reciprocates(senderId, receiverId, type) {
    var result = Relations.findOne({"senderId":receiverId, "receiverId":senderId, "type":type});
    var reciprocated = !(typeof result == 'undefined') && (result.published === true)
    return reciprocated
}
function getEmail(id) {
    var doc = UserData.findOne({"id":id});
    return doc.email
}
function getName(id) {
    var doc = UserData.findOne({"id":id});
    return doc.email
}
function getId(meteorId) {
    var doc = UserData.findOne({"meteorId":meteorId});
    return doc.id
}
//function permute(doc) {
//    newDoc = doc
//    newDoc.senderId = doc.receiverId
//    newDoc.receiverId = doc.senderId
//    return [doc, newDoc]
//}

Meteor.methods({
    registerUser : function() {
        if (!(Meteor.user() && Meteor.user().services)) {
            return false;
        }
        var user = Meteor.user().services.facebook
    	fbgraph.setAccessToken(user.accessToken);
        var getFriends = function(s) {
            fbgraph.get(s, Meteor.bindEnvironment(function(err, res) {
                if (res.paging && res.paging.next) {
                    getFriends(res.paging.next)
                }

                for (var i = 0; i < res["data"].length; i++) {
                    var datum = res["data"][i];

                    datum["senderId"]=user.id;
                    datum["senderMeteorId"] = Meteor.userId()

                    var selector = {};
                    selector["senderId"] = datum["senderId"];
                    selector["senderMeteorId"] = Meteor.userId()
                    selector["id"] = datum["id"];

                    Friends.upsert(selector, datum);
                }
            }));
        }
        getFriends('me/friends?fields=picture,name,link');
    	var data = Meteor.wrapAsync(fbgraph.get)('me?fields=email,name')
    	var picture = Meteor.wrapAsync(fbgraph.get)('me?fields=picture').picture
        var selector = {"id":user.id}
        var doc = {
            "id":user.id,
            "email":data.email,
            "name":data.name,
            "meteorId":Meteor.userId(),
            "picture":picture,
        }
        UserData.upsert(selector, doc)
    	return true;
    },
    notify : function({receiverId, type}) {
        let senderId = Meteor.user().services.facebook.id;
        let selector = {"senderId":senderId, "receiverId":receiverId,
            "type":type, "reciprocated":true};
        let updated = Relations.update(selector, {$set: {"alerted":true}});
        return (updated > 0)
    },
    setNote : function({note}) {
        var id = Meteor.user().services.facebook.id;
        var selector = {"id":id};
        var datum = {"id":id, "note":note};
        Notes.upsert(selector, datum)
    },
    getNote : function({id}){
        var doc = Notes.findOne({"id":id});
        return doc["note"]
    },
    getPicture : function() {
    	fbgraph.setAccessToken(Meteor.user().services.facebook.accessToken);
    	return Meteor.wrapAsync(fbgraph.get)('me?fields=picture').picture
    },
    getMe : function({s}) {
    	fbgraph.setAccessToken(Meteor.user().services.facebook.accessToken);
    	var result = Meteor.wrapAsync(fbgraph.get)('me' + s)
    	return result
    },
    addRelation : function({receiverId, type}) {
        let senderId = Meteor.user().services.facebook.id;
        let unremoveSelector = {"senderId":senderId, "receiverId":receiverId,
            "type":type, "reciprocated":false, "to_remove":true};
        let unremoved = Relations.update(unremoveSelector, {$set: {"to_remove":false}});
        if (unremoved == 0) {
            let selector = {"senderId":senderId, "receiverId":receiverId,
                "type":type, "reciprocated":false};
            let doc = {
                $set: {"senderId":senderId, "receiverId":receiverId,
                "type":type,
                "senderMeteorId":Meteor.userId(),
                "published":false, "to_remove":false, "reciprocated":false,
                "alerted":false}
            };
            Relations.upsert(selector, doc);
        }
    },
    publishRelations : function() {
        let senderId = Meteor.user().services.facebook.id;
        Relations.remove(
            {"senderId":senderId, "to_remove":true}
        );
        let updated_relations = Relations.find(
            {"senderId":senderId, "published":false}
        ).fetch();
        Relations.update(
            {"senderId":senderId, "published":false},
            {$set: {"published":true}},
            {multi:true}
        );
        updated_relations.forEach(function (doc){
            checkAndProcessReciprocity(senderId, doc.receiverId, doc.type)
        })
    },
    removeRelation : function({receiverId, type}) {
        var senderId = Meteor.user().services.facebook.id;
        Relations.update(
            {"senderId":senderId, "receiverId":receiverId, "type":type, "reciprocated":false},
            {$set: {"to_remove":true}}
        )
    },
    getRelations : function() {
        var cursor = Relations.find({"senderId":Meteor.user().services.facebook.id});
        var result = [];
        cursor.forEach(function(item) {
            result.push({"receiverId":item.receiverId, "type":item.type});
        })
        return result;
    },
    getFriends : function() {
    }
})
